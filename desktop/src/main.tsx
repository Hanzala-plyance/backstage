import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installRiff } from "./core/riff";
import "./style.css";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="loading">
        <h1>Let’s reset the stage.</h1>
        <p>Backstage encountered a problem. Your song files are safe.</p>
        <button onClick={() => location.reload()}>Reload Backstage</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
installRiff();
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
