import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/global.css";
import { render } from "solid-js/web";
import App from "./components/shell/App";
import { initSystemLocale } from "./lib/system-locale";

initSystemLocale().finally(() => {
  render(() => <App />, document.getElementById("root")!);
});
