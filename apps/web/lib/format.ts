// Money and token counts the way people read them.
export const fmtUsd = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);
export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
export const fmtMinutes = (s: number) => (s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);
