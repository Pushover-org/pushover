import { AppNav } from "@/components/app/AppNav.tsx";
import { currentAnalyst } from "@/lib/server/auth.ts";
import s from "./app.module.css";

/** Product screens: calm, fast, no scroll effects (docs/design-direction.md). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentAnalyst();
  return (
    <div className={s.shell}>
      <AppNav analyst={me ? { name: me.name, role: me.role } : null} />
      <main id="main" className={s.main}>
        {children}
      </main>
      <footer className={s.foot}>
        <span>Acme Restaurant Beverage Settlement is fictional. Payments run in PayPal&apos;s sandbox with play money.</span>
        <span>The model reads evidence. The rules decide. A person reviews.</span>
      </footer>
    </div>
  );
}
