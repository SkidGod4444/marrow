"use client";

import { ErrorView } from "@/components/marrow/error-view";

// Catches errors thrown by the (app) layout itself (e.g. the API unreachable while it asks who is signed in);
// a segment's own error.tsx only covers what is inside it.
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
      <ErrorView {...props} />
    </main>
  );
}
