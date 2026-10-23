import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CopyIcon, EyeIcon, EyeOffIcon, GiftIcon, GlobeIcon, LogOutIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { iconUrl, useItems } from "@/lib/items";
import { VISIBILITY_NAMES, useLobby, type Friend, type ListedLobby, type LobbyState, type Visibility } from "@/lib/lobby";
import { usePrefs } from "@/lib/prefs";

const chipClass =
  "h-8 rounded-full border-2 border-border px-3 font-heading aria-pressed:border-outline aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-sticker-sm aria-pressed:hover:bg-primary";

const fail = (e: unknown) => void toast.error(String(e));

function Card({ title, icon: Icon, action, children }: { title: string; icon: ComponentType<{ className?: string }>; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-4 text-primary" />
        </span>
        <span className="flex-1">{title}</span>
        {action}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function VisibilityPicker({ value, disabled, onChange }: { value: Visibility; disabled?: boolean; onChange: (v: Visibility) => void }) {
  return (
    <ToggleGroup spacing={1} disabled={disabled} value={[String(value)]} onValueChange={(v) => v[0] && onChange(Number(v[0]) as Visibility)}>
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
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    invoke<ListedLobby[]>("lobby_list")
      .then(setList)
      .catch((e) => {
        setList([]);
        fail(e);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <Card title="Public lobbies" icon={GlobeIcon} action={<Refresh onClick={load} loading={loading} />}>
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
    </Card>
  );
}

function Browse() {
  const [busy, run] = useRun();
  const [code, setCode] = useState("");
  const [custom, setCustom] = useState("");
  const [vis, setVis] = useState<Visibility>(2);
  const join = () => code.length >= 5 && run("lobby_join", { code });

  return (
    <>
      <Card title="Join" icon={UsersIcon}>
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
      <Card title="Create" icon={UsersIcon}>
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
      <PublicLobbies busy={busy} run={run} />
    </>
  );
}

function Invite() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    invoke<Friend[]>("lobby_friends")
      .then(setFriends)
      .catch((e) => {
        setFriends([]);
        fail(e);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const invite = (id: string) =>
    invoke("lobby_invite", { friend: id })
      .then(() => setInvited((v) => [...v, id]))
      .catch(fail);

  return (
    <Card title="Invite friends" icon={UsersIcon} action={<Refresh onClick={load} loading={loading} />}>
      {friends?.length === 0 && <p className="text-sm text-muted-foreground">No friends online.</p>}
      {friends?.map((f) => (
        <div key={f.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
          {f.in_game && <Badge variant="secondary">Playing</Badge>}
          <Button size="sm" disabled={invited.includes(f.id)} onClick={() => invite(f.id)}>
            {invited.includes(f.id) ? "Invited" : "Invite"}
          </Button>
        </div>
      ))}
      {!friends && <Spinner className="mx-auto" />}
    </Card>
  );
}

function Joined({ lobby }: { lobby: LobbyState }) {
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
      <Card title="Lobby" icon={UsersIcon}>
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
            <span className="flex h-8 items-center rounded-full border-2 border-outline bg-card px-3 text-sm font-semibold shadow-sticker-sm">Private lobby</span>
          ) : (
            <>
              <span className="flex h-8 items-center rounded-full border-2 border-outline bg-card px-3 font-mono text-sm font-semibold shadow-sticker-sm">{lobby.code}</span>
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
      <Card title={`Players · ${lobby.members.length}`} icon={UsersIcon}>
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
      <Invite />
    </>
  );
}

export function Lobby() {
  const lobby = useLobby();
  useEffect(() => {
    const un = listen<string>("lobby-error", (e) => toast.error(e.payload));
    return () => void un.then((f) => f());
  }, []);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-1 pr-3">{lobby ? <Joined lobby={lobby} /> : <Browse />}</div>
    </ScrollArea>
  );
}
