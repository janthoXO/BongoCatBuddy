import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronRightIcon, CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GiftIcon, LogInIcon, LogOutIcon, RefreshCwIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { iconUrl, useItems } from "@/lib/items";
import { VISIBILITY_NAMES, useLobby, type Friend, type ListedLobby, type LobbyPage, type LobbyState, type Visibility } from "@/lib/lobby";
import { usePrefs } from "@/lib/prefs";

const chipClass =
  "h-7 rounded-md px-3 text-sm aria-pressed:bg-card dark:aria-pressed:bg-white/15 aria-pressed:shadow-sm";

const fail = (e: unknown) => void toast.error(String(e));

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">{title}</span>
        {action}
      </h2>
      <div className="flex flex-col gap-3 rounded-xl bg-card p-3">{children}</div>
    </section>
  );
}

function VisibilityPicker({ value, disabled, onChange }: { value: Visibility; disabled?: boolean; onChange: (v: Visibility) => void }) {
  return (
    <ToggleGroup spacing={0} className="w-fit rounded-lg bg-muted p-0.5" disabled={disabled} value={[String(value)]} onValueChange={(v) => v[0] && onChange(Number(v[0]) as Visibility)}>
      {VISIBILITY_NAMES.map((n, i) => (
        <ToggleGroupItem key={n} value={String(i)} className={chipClass}>
          {n}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const Refresh = ({ onClick, loading }: { onClick: () => void; loading: boolean }) => (
  <Button variant="ghost" size="icon-sm" aria-label="Refresh" disabled={loading} onClick={onClick}>
    {loading ? <Spinner /> : <RefreshCwIcon />}
  </Button>
);

/** Runs a lobby command, tracking whether one is pending and toasting failures. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (cmd: string, args?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await invoke(cmd, args);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run] as const;
}

function PublicLobbies({ busy, run }: { busy: boolean; run: ReturnType<typeof useRun>[1] }) {
  const [list, setList] = useState<ListedLobby[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Steam has no offset: the next page skips every lobby name we already have (unnamed ones can repeat, so dedupe by id)
  const load = useCallback((have: ListedLobby[]) => {
    setLoading(true);
    invoke<LobbyPage>("lobby_list", { skip: [...new Set(have.map((l) => l.name).filter(Boolean))] })
      .then((p) => {
        setList([...have, ...p.lobbies.filter((l) => !have.some((h) => h.id === l.id))]);
        setMore(p.more);
      })
      .catch((e) => {
        setList(have);
        setMore(false);
        fail(e);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load([]), [load]);

  return (
    <Card title="Public lobbies" action={<Refresh onClick={() => load([])} loading={loading} />}>
      {list?.length === 0 ? (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyTitle>No public lobbies</EmptyTitle>
            <EmptyDescription>Create one and others can find it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        list?.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{l.name || "Unnamed lobby"}</span>
            <Badge variant="secondary" className="tabular-nums">
              {l.members}/{l.max}
            </Badge>
            <Button size="sm" disabled={busy} onClick={() => run("lobby_join_id", { id: l.id })}>
              Join
            </Button>
          </div>
        ))
      )}
      {!list && <Spinner className="mx-auto" />}
      {more && (
        <Button variant="outline" disabled={loading} onClick={() => load(list ?? [])}>
          {loading && <Spinner />}
          Load more
        </Button>
      )}
    </Card>
  );
}

function Browse({ friends }: { friends: ReactNode }) {
  const [busy, run] = useRun();
  const [code, setCode] = useState("");
  const [custom, setCustom] = useState("");
  const [vis, setVis] = useState<Visibility>(2);
  const join = () => code.length >= 5 && run("lobby_join", { code });

  return (
    <>
      <Card title="Join">
        <div className="flex gap-2">
          <Input
            value={code}
            maxLength={12}
            placeholder="Lobby code"
            onChange={(e) => setCode(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <Button disabled={busy || code.length < 5} onClick={join}>
            {busy && <Spinner />}
            Join
          </Button>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => run("lobby_join_random")}>
          Join random
        </Button>
      </Card>
      <Card title="Create">
        <VisibilityPicker value={vis} onChange={setVis} />
        <div className="flex gap-2">
          <Input value={custom} maxLength={12} placeholder="Custom code (optional)" onChange={(e) => setCustom(e.target.value.trim())} />
          <Button
            disabled={busy || (custom.length > 0 && custom.length < 5)}
            onClick={() => run("lobby_create", { visibility: vis, code: custom || undefined })}
          >
            Create
          </Button>
        </div>
      </Card>
      {friends}
      <PublicLobbies busy={busy} run={run} />
    </>
  );
}

/** Friend ids we invited, by lobby id. */
type Invited = Record<string, string[]>;

function FriendRow({ f, lobby, invited, onInvite }: { f: Friend; lobby: LobbyState | null; invited: boolean; onInvite: () => void }) {
  const [busy, run] = useRun();
  const [open, setOpen] = useState(false);
  const here = f.lobby != null && f.lobby === lobby?.id;
  return (
    <div
      className="flex items-center gap-2"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
      {here ? <Badge>In your lobby</Badge> : f.lobby && <Badge variant="secondary">In a lobby</Badge>}
      {invited && <Badge variant="outline">Invited</Badge>}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          {f.in_game && (
            <DropdownMenuItem disabled={busy || !f.lobby || here} onClick={() => run("lobby_join_id", { id: f.lobby })}>
              <LogInIcon />
              Join game
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={invited || here} onClick={onInvite}>
            <UserPlusIcon />
            {lobby ? "Invite to lobby" : "Create lobby and invite"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Online friends: the ones playing Bongo Cat (game or Buddy) up top, the rest folded away. */
function Friends({ lobby, invited, onInvited }: { lobby: LobbyState | null; invited: Invited; onInvited: (lobby: string, friend: string) => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [loading, setLoading] = useState(false);
  const poll = useCallback(
    () =>
      invoke<Friend[]>("lobby_friends")
        .then(setFriends)
        .catch((e) => {
          setFriends([]);
          fail(e);
        }),
    [],
  );
  const load = useCallback(() => {
    setLoading(true);
    poll().finally(() => setLoading(false));
  }, [poll]);
  useEffect(() => {
    load();
    // ponytail: poll, PersonaStateChange push if 5 s feels slow
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [load, poll]);

  const invite = (id: string) =>
    invoke<string>("lobby_invite", { friend: id })
      .then((l) => onInvited(l, id))
      .catch(fail);
  const row = (f: Friend) => (
    <FriendRow key={f.id} f={f} lobby={lobby} invited={!!lobby && !!invited[lobby.id]?.includes(f.id)} onInvite={() => invite(f.id)} />
  );
  const playing = friends?.filter((f) => f.in_game) ?? [];
  const others = friends?.filter((f) => !f.in_game) ?? [];

  return (
    <Card title="Friends" action={<Refresh onClick={load} loading={loading} />}>
      {friends && playing.length === 0 && <p className="text-sm text-muted-foreground">No friends playing Bongo Cat right now.</p>}
      {playing.map(row)}
      {others.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground">
            <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
            Other online friends · {others.length}
          </summary>
          <div className="mt-3 flex flex-col gap-3">{others.map(row)}</div>
        </details>
      )}
      {!friends && <Spinner className="mx-auto" />}
    </Card>
  );
}

function Joined({ lobby, friends }: { lobby: LobbyState; friends: ReactNode }) {
  const { catalog } = useItems();
  const [prefs, update] = usePrefs();
  const [busy, run] = useRun();
  const [name, setName] = useState(lobby.name);
  useEffect(() => setName(lobby.name), [lobby.name]);

  const saveName = () => name !== lobby.name && run("lobby_configure", { name });
  const leave = async () => {
    if (await run("lobby_leave")) update({ lastLobby: undefined });
  };
  const toggleHidden = (id: string) =>
    update({ hiddenPlayers: prefs.hiddenPlayers.includes(id) ? prefs.hiddenPlayers.filter((h) => h !== id) : [...prefs.hiddenPlayers, id] });
  const icon = (id: number | null) => {
    const it = id == null ? undefined : catalog?.get(id);
    return it && <img key={id} src={iconUrl(it)} alt={it.name} title={it.name} className="size-6 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />;
  };

  return (
    <>
      <Card title="Lobby">
        {lobby.owner ? (
          <Input
            value={name}
            maxLength={32}
            placeholder="Lobby name"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
        ) : (
          <p className="font-medium">{lobby.name || "Unnamed lobby"}</p>
        )}
        <div className="flex items-center gap-2">
          {lobby.visibility === 0 ? (
            <span className="rounded-md bg-muted px-2 py-1 text-sm">Private lobby</span>
          ) : (
            <>
              <span className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{lobby.code}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy code"
                onClick={() => navigator.clipboard.writeText(lobby.code).then(() => toast("Copied"), fail)}
              >
                <CopyIcon />
              </Button>
            </>
          )}
        </div>
        <VisibilityPicker value={lobby.visibility} disabled={!lobby.owner || busy} onChange={(visibility) => run("lobby_configure", { visibility })} />
        <Button variant="destructive" disabled={busy} onClick={leave}>
          <LogOutIcon />
          Leave
        </Button>
      </Card>
      <Card title={`Players · ${lobby.members.length}`}>
        {lobby.members.map((m) => {
          const hidden = prefs.hiddenPlayers.includes(m.id);
          return (
            <div key={m.id} className="flex items-center gap-2">
              <span className="min-w-0 truncate font-medium">{m.name}</span>
              {m.id === lobby.me && <Badge>You</Badge>}
              {icon(m.hat)}
              {icon(m.skin)}
              {(m.chest_ready || m.emote_chest_ready) && <GiftIcon className="size-4 text-primary" aria-label="Chest ready" />}
              <span className="flex-1" />
              {m.id !== lobby.me && (
                <Button variant="ghost" size="icon-sm" aria-label={hidden ? "Show cat" : "Hide cat"} onClick={() => toggleHidden(m.id)}>
                  {hidden ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              )}
            </div>
          );
        })}
      </Card>
      {friends}
    </>
  );
}

export function Lobby() {
  const lobby = useLobby();
  useEffect(() => {
    const un = listen<string>("lobby-error", (e) => toast.error(e.payload));
    return () => void un.then((f) => f());
  }, []);

  // lives here so an invite that creates a lobby (Browse -> Joined) keeps it
  const [invited, setInvited] = useState<Invited>({});
  const onInvited = useCallback((l: string, f: string) => setInvited((v) => ({ ...v, [l]: [...(v[l] ?? []), f] })), []);
  const friends = <Friends lobby={lobby} invited={invited} onInvited={onInvited} />;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-1 pr-3">{lobby ? <Joined lobby={lobby} friends={friends} /> : <Browse friends={friends} />}</div>
    </ScrollArea>
  );
}
