import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/global.css";
import { render } from "solid-js/web";
import App from "./components/shell/App";
import { initSystemLocale } from "./lib/system-locale";

const root = document.getElementById("root")!;
let dispose: (() => void) | undefined;

void initSystemLocale().finally(() => {
  dispose?.();
  dispose = render(() => <App />, root);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    dispose?.();
    dispose = undefined;
  });
}
