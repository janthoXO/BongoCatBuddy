//! Minimal blocking wrapper around ISteamInventory (not wrapped by the steamworks crate).
//!
//! Every call returns a result handle that Steam fills in asynchronously; we poll
//! it until it is no longer pending. Callbacks are pumped by the main loop.

use std::ffi::{CStr, CString};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use steamworks_sys as sys;

pub type Def = i32;

#[derive(Clone, Copy, Debug)]
pub struct Stack {
    pub instance: u64,
    pub def: Def,
    pub qty: u32,
}

#[derive(Clone, Serialize)]
pub struct ItemDef {
    pub id: Def,
    pub name: String,
    /// "item", "bundle", "generator", ...
    pub kind: String,
    /// raw `key:value;key:value` tag string, parsed by the front end
    pub tags: String,
    pub name_color: String,
}

const TIMEOUT: Duration = Duration::from_secs(30);

fn inv() -> *mut sys::ISteamInventory {
    unsafe { sys::SteamAPI_SteamInventory_v003() }
}

/// Waits for a result handle and returns its items, always freeing the handle.
fn wait(handle: sys::SteamInventoryResult_t) -> Result<Vec<Stack>, String> {
    let start = Instant::now();
    let status = loop {
        let s = unsafe { sys::SteamAPI_ISteamInventory_GetResultStatus(inv(), handle) };
        if s != sys::EResult::k_EResultPending {
            break s;
        }
        if start.elapsed() > TIMEOUT {
            unsafe { sys::SteamAPI_ISteamInventory_DestroyResult(inv(), handle) };
            return Err("Steam inventory timed out".into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let mut out = Vec::new();
    if status == sys::EResult::k_EResultOK {
        let mut n = 0u32;
        unsafe { sys::SteamAPI_ISteamInventory_GetResultItems(inv(), handle, std::ptr::null_mut(), &mut n) };
        let mut raw = vec![
            sys::SteamItemDetails_t { m_itemId: 0, m_iDefinition: 0, m_unQuantity: 0, m_unFlags: 0 };
            n as usize
        ];
        unsafe { sys::SteamAPI_ISteamInventory_GetResultItems(inv(), handle, raw.as_mut_ptr(), &mut n) };
        // Flag 0x100 = removed: the item is gone after this result (consumed/exchanged).
        out = raw
            .iter()
            .filter(|d| d.m_unFlags & 0x100 == 0)
            .map(|d| Stack { instance: d.m_itemId, def: d.m_iDefinition, qty: d.m_unQuantity as u32 })
            .collect();
    }
    unsafe { sys::SteamAPI_ISteamInventory_DestroyResult(inv(), handle) };
    if status == sys::EResult::k_EResultOK {
        Ok(out)
    } else {
        Err(format!("Steam inventory error: {status:?}"))
    }
}

/// Runs one inventory call that fills a result handle, then waits for it.
fn call(f: impl FnOnce(*mut sys::SteamInventoryResult_t) -> bool) -> Result<Vec<Stack>, String> {
    let mut handle: sys::SteamInventoryResult_t = -1;
    if !f(&mut handle) {
        return Err("Steam rejected the inventory request".into());
    }
    wait(handle)
}

pub fn all_items() -> Result<Vec<Stack>, String> {
    call(|h| unsafe { sys::SteamAPI_ISteamInventory_GetAllItems(inv(), h) })
}

pub fn heartbeat() {
    unsafe { sys::SteamAPI_ISteamInventory_SendItemDropHeartbeat(inv()) }
}

pub fn trigger_drop(generator: Def) -> Result<Vec<Stack>, String> {
    call(|h| unsafe { sys::SteamAPI_ISteamInventory_TriggerItemDrop(inv(), h, generator) })
}

pub fn grant_promos() -> Result<Vec<Stack>, String> {
    call(|h| unsafe { sys::SteamAPI_ISteamInventory_GrantPromoItems(inv(), h) })
}

pub fn add_promos(defs: &[Def]) -> Result<Vec<Stack>, String> {
    call(|h| unsafe { sys::SteamAPI_ISteamInventory_AddPromoItems(inv(), h, defs.as_ptr(), defs.len() as u32) })
}

pub fn consume(instance: u64, qty: u32) -> Result<Vec<Stack>, String> {
    call(|h| unsafe { sys::SteamAPI_ISteamInventory_ConsumeItem(inv(), h, instance, qty) })
}

/// Exchanges `inputs` (instance, qty) for one `recipe`. Returns the resulting items.
pub fn exchange(recipe: Def, inputs: &[(u64, u32)]) -> Result<Vec<Stack>, String> {
    let ids: Vec<u64> = inputs.iter().map(|i| i.0).collect();
    let qtys: Vec<u32> = inputs.iter().map(|i| i.1).collect();
    call(|h| unsafe {
        sys::SteamAPI_ISteamInventory_ExchangeItems(
            inv(),
            h,
            &recipe,
            &1,
            1,
            ids.as_ptr(),
            qtys.as_ptr(),
            ids.len() as u32,
        )
    })
}

/// Picks `qty` units of `def` from the owned stacks, as exchange/consume inputs.
pub fn pick(stacks: &[Stack], def: Def, qty: u32) -> Option<Vec<(u64, u32)>> {
    let mut left = qty;
    let mut out = Vec::new();
    for s in stacks.iter().filter(|s| s.def == def && s.qty > 0) {
        if left == 0 {
            break;
        }
        let take = s.qty.min(left);
        out.push((s.instance, take));
        left -= take;
    }
    (left == 0).then_some(out)
}

pub fn count(stacks: &[Stack], def: Def) -> u32 {
    stacks.iter().filter(|s| s.def == def).map(|s| s.qty).sum()
}

/// All item definitions, or None while Steam is still downloading them.
pub fn definitions() -> Option<Vec<ItemDef>> {
    unsafe { sys::SteamAPI_ISteamInventory_LoadItemDefinitions(inv()) };
    let mut n = 0u32;
    if !unsafe { sys::SteamAPI_ISteamInventory_GetItemDefinitionIDs(inv(), std::ptr::null_mut(), &mut n) } || n == 0 {
        return None;
    }
    let mut ids = vec![0; n as usize];
    unsafe { sys::SteamAPI_ISteamInventory_GetItemDefinitionIDs(inv(), ids.as_mut_ptr(), &mut n) };
    Some(
        ids.into_iter()
            .map(|id| ItemDef {
                id,
                name: prop(id, "name"),
                kind: prop(id, "type"),
                tags: prop(id, "tags"),
                name_color: prop(id, "name_color"),
            })
            .collect(),
    )
}

fn prop(def: Def, name: &str) -> String {
    let key = CString::new(name).unwrap();
    let mut buf = vec![0u8; 4096];
    let mut len = buf.len() as u32;
    let ok = unsafe {
        sys::SteamAPI_ISteamInventory_GetItemDefinitionProperty(inv(), def, key.as_ptr(), buf.as_mut_ptr().cast(), &mut len)
    };
    if !ok {
        return String::new();
    }
    CStr::from_bytes_until_nul(&buf).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_spans_stacks_and_fails_when_short() {
        let s = [
            Stack { instance: 1, def: 5, qty: 3 },
            Stack { instance: 2, def: 7, qty: 9 },
            Stack { instance: 3, def: 5, qty: 4 },
        ];
        assert_eq!(pick(&s, 5, 5), Some(vec![(1, 3), (3, 2)]));
        assert_eq!(pick(&s, 5, 8), None);
        assert_eq!(count(&s, 5), 7);
    }
}
