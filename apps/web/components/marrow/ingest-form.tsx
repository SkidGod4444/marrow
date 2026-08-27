"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NEW = "__new__";

const isYouTubeVideo = (u: string) => /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i.test(u);
const isYouTubeList = (u: string) => /youtube\.com\/(playlist\?|@|channel\/|c\/|user\/)/i.test(u) || /[?&]list=/.test(u);
const looksLikeFeed = (u: string) => /\.(xml|rss|atom)(\?|$)|\/(feed|rss)\/?(\?|$)/i.test(u);

/**
 * Library header: pick (or create) a namespace and add something to it. A link is routed by what it is —
 * YouTube video → ingest, playlist/channel/feed → follow, anything else → capture (PRD §7); "Text" captures a pasted post.
 */
export function IngestForm({ namespaces: initial }: { namespaces: string[] }) {
  const router = useRouter();
  const [namespaces, setNamespaces] = useState(initial);
  const [mode, setMode] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [namespace, setNamespace] = useState<string>(initial[0] ?? "");
  const [busy, setBusy] = useState(false);
  // "New namespace…" opens a small dialog; the select never shows the sentinel. With no namespace yet, pressing Add
  // asks for a name first and then continues the add — a first-time user is never stuck on a disabled button.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [continueAfterCreate, setContinueAfterCreate] = useState(false);
  const canSubmit = mode === "link" ? url.trim().length > 0 : text.trim().length > 0;

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`/api/marrow/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as Record<string, unknown> & { error?: string };
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return json;
  };

  const createNamespace = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    setCreatingBusy(true);
    try {
      await post("namespaces", { name });
      setNamespaces((ns) => (ns.includes(name) ? ns : [...ns, name]));
      setNamespace(name);
      setNewName("");
      setCreating(false);
      toast.success("Namespace created", { description: `Everything you add now goes into ${name}.` });
      if (continueAfterCreate) {
        setContinueAfterCreate(false);
        await add(name);
      } else router.refresh();
    } catch (err) {
      toast.error("Couldn't create the namespace", { description: (err as Error).message });
    } finally {
      setCreatingBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (!namespace) {
      setContinueAfterCreate(true);
      setCreating(true);
      return;
    }
    await add(namespace);
  };

  const add = async (namespace: string) => {
    setBusy(true);
    try {
      const link = url.trim();
      let reused = false;
      if (mode === "text") {
        const r = await post("capture", { namespace, text: text.trim(), title: title.trim() || undefined });
        reused = Boolean(r.reused);
        const linked = (r.linked_videos as string[] | undefined)?.length ?? 0;
        toast.success(reused ? "Already captured" : "Captured", { description: linked ? `${linked} linked video${linked === 1 ? "" : "s"} found — ingest ${linked === 1 ? "it" : "them"} from the item page.` : "It'll be readable and searchable in a moment." });
        setText("");
        setTitle("");
      } else if (isYouTubeVideo(link)) {
        const r = await post("ingest", { namespace, url: link });
        reused = Boolean(r.reused);
        toast.success(reused ? "Already in the library" : "Queued", { description: reused ? "Resuming if it had failed." : "Watch it come in on the inbox." });
        setUrl("");
      } else if (isYouTubeList(link) || looksLikeFeed(link)) {
        const r = await post("sources", { namespace, url: link });
        const queued = ((r.poll as { queued?: string[] } | null)?.queued ?? []).length;
        toast.success(r.created ? "Following" : "Already following", { description: queued ? `${queued} item${queued === 1 ? "" : "s"} queued from the first check.` : "Checked just now; new entries are picked up automatically." });
        setUrl("");
        router.refresh();
        return;
      } else {
        const r = await post("capture", { namespace, url: link });
        reused = Boolean(r.reused);
        const linked = (r.linked_videos as string[] | undefined)?.length ?? 0;
        toast.success(reused ? "Already captured" : "Captured", { description: linked ? `${linked} linked video${linked === 1 ? "" : "s"} found — ingest ${linked === 1 ? "it" : "them"} from the item page.` : "It'll be readable and searchable in a moment." });
        setUrl("");
      }
      if (reused) router.refresh();
      else router.push("/");
    } catch (err) {
      toast.error(mode === "text" ? "Couldn't capture" : "Couldn't add that", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`flex w-full flex-col gap-2 ${mode === "text" ? "basis-full" : "sm:w-auto"}`}>
      <div className="flex w-full flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border/70 p-0.5" role="tablist" aria-label="What to add">
          {(["link", "text"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`cursor-pointer rounded-[5px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {m}
            </button>
          ))}
        </div>
        <Select
          value={namespace || null}
          items={[...namespaces.map((n) => ({ value: n, label: n })), { value: NEW, label: "New namespace…" }]}
          onValueChange={(v) => {
            if (v === NEW) setCreating(true);
            else if (v) setNamespace(v);
          }}
        >
          <SelectTrigger className="w-40 font-mono text-[13px]" aria-label="Namespace">
            <SelectValue placeholder="Namespace" />
          </SelectTrigger>
          <SelectContent>
            {namespaces.map((n) => (
              <SelectItem key={n} value={n} className="font-mono text-[13px]">
                {n}
              </SelectItem>
            ))}
            <SelectItem value={NEW}>New namespace…</SelectItem>
          </SelectContent>
        </Select>
        <Dialog
          open={creating}
          onOpenChange={(o) => {
            setCreating(o);
            if (!o) setContinueAfterCreate(false);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <form onSubmit={createNamespace} className="space-y-4">
              <DialogHeader>
                <DialogTitle className="reading">{continueAfterCreate ? "Name a namespace first" : "New namespace"}</DialogTitle>
                <DialogDescription>A namespace is a folder for one topic — everything you add to it is searched, summarised and mapped together. Short and lowercase works best, e.g. robotics.</DialogDescription>
              </DialogHeader>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. sim-to-real" className="font-mono text-sm" autoFocus aria-label="Namespace name" />
              <DialogFooter>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={creatingBusy || !newName.trim()}>
                  {creatingBusy ? "Creating…" : continueAfterCreate ? "Create and add" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        {mode === "link" && <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube video, article, paper or feed URL" className="w-72" aria-label="URL" />}
        {mode === "link" && (
          <Button type="submit" disabled={busy || !canSubmit}>
            {busy ? "Adding…" : "Add"}
          </Button>
        )}
      </div>
      {mode === "text" && (
        <div className="flex w-full max-w-2xl flex-col gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="font-sans" aria-label="Title" />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a post, thread, or newsletter text…" rows={5} aria-label="Text to capture" className="reading text-[15px]" />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? "Capturing…" : "Capture"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
