import { useEffect, useState } from "react";
import { Logo } from "./components/Logo";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeToggle } from "./components/ThemeToggle";
import { useRoute } from "./app/router";
import { TOOL_BY_ID } from "./tools/registry";
import { Home, NotFound } from "./pages/Home";
import { ToolPage } from "./pages/ToolPage";
import { Editor } from "./pages/Editor";
import { Organizer } from "./pages/Organizer";
import { Scanner } from "./pages/Scanner";

export function App() {
  const [section, id] = useRoute();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 4);
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  const tool = section === "tool" && id ? TOOL_BY_ID[id] : null;
  const fullscreen = !!tool?.page;

  let body;
  if (!section) body = <Home />;
  else if (!tool) body = <NotFound />;
  else if (tool.page === "editor") body = <Editor key={tool.id} tool={tool} />;
  else if (tool.page === "organizer") body = <Organizer key={tool.id} tool={tool} />;
  else if (tool.page === "scanner") body = <Scanner key={tool.id} tool={tool} />;
  else body = <ToolPage key={tool.id} tool={tool} />;

  return (
    <div className="shell">
      <header className={`topbar${scrolled || fullscreen ? " scrolled" : ""}`}>
        <Logo />
        <span className="spacer" />
        <ThemeToggle />
      </header>
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <ErrorBoundary key={section + (id ?? "")}>{body}</ErrorBoundary>
      </main>
      {!fullscreen && (
        <footer className="footer">
          <div className="inner">
            <span>DrDoc: Doctor Document. Files are processed in your browser and never uploaded.</span>
            <span>Open source under AGPL-3.0 · Powered by MuPDF</span>
          </div>
        </footer>
      )}
    </div>
  );
}
