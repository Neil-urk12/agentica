import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import {
  applyAppearance,
  readAccent,
  readDesign,
  readTheme,
} from "./lib/theme";

// Applied before mount so the first paint already uses the stored appearance.
const theme = readTheme();
applyAppearance({
  theme,
  design: readDesign(),
  accent: readAccent(theme),
});

const target = document.getElementById("app");

if (!target) throw new Error("Application mount element is missing.");

mount(App, { target });
