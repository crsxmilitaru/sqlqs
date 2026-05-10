import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/global.css";
import { render } from "solid-js/web";
import App from "./components/shell/App";

render(() => <App />, document.getElementById("root")!);
