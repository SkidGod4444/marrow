import { redirect } from "next/navigation";
import { LoginForm } from "@/components/marrow/login-form";
import { AUTH_ENABLED, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { SITE_DESCRIPTION } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Marrow — talks, lectures and podcasts, turned into searchable knowledge" },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/login" },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!AUTH_ENABLED) redirect("/");
  if (await getSession()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-10 sm:px-5">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5 font-serif text-[22px] font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/marrow-mark.png?v=2" alt="" width={26} height={26} className="size-[26px] rounded-[6px]" />
          Marrow
        </div>
        <LoginForm mode="sign-in" next={next} />
      </div>
    </main>
  );
}
