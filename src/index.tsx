import { render } from "preact";
import { App } from "./components/App";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app root element");
}

render(<App />, app);
