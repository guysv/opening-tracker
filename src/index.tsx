import { render } from "preact";
import { LocationProvider } from "preact-iso";

import { App } from "./components/App";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app root element");
}

render(
  <LocationProvider>
    <App />
  </LocationProvider>,
  app,
);
