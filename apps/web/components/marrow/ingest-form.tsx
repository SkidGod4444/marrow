"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW = "__new__";

/** Library header: pick (or create) a namespace and queue a YouTube URL through the proxied API. */
export function IngestForm({ namespaces }: { namespaces: string[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState<string>(namespaces[0] ?? NEW);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = choice === NEW;
  const namespace = creating ? newName.trim().toLowerCase() : choice;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !namespace) return;
    setBusy(true);
    try {
      if (creating) {
        const r = await fetch("/api/marrow/namespaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: namespace }) });
        if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "Could not create namespace");
      }
      const res = await fetch("/api/marrow/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace, url: url.trim() }) });
      const body = (await res.json()) as { job_id?: string; reused?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast.success(body.reused ? "Already in the library" : "Queued", { description: body.reused ? "Resuming if it had failed." : "Watch it come in on the inbox." });
      setUrl("");
      if (creating) {
        setChoice(namespace);
        setNewName("");
      }
      if (body.reused) router.refresh();
      else router.push("/");
    } catch (err) {
      toast.error("Couldn't ingest", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <Select value={choice} onValueChange={(v) => setChoice(v ?? NEW)}>
        <SelectTrigger className="w-40" aria-label="Namespace">
          <SelectValue placeholder="Namespace" />
        </SelectTrigger>
        <SelectContent>
          {namespaces.map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
          <SelectItem value={NEW}>New namespace…</SelectItem>
        </SelectContent>
      </Select>
      {creating && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. sim-to-real" className="w-40 font-mono text-sm" aria-label="New namespace name" />}
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube URL" className="w-64" aria-label="YouTube URL" />
      <Button type="submit" disabled={busy || !url.trim() || !namespace}>
        {busy ? "Queuing…" : "Ingest"}
      </Button>
    </form>
  );
}
