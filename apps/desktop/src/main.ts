import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { applyTheme, readTheme } from "./lib/theme";

applyTheme(readTheme());

const target = document.getElementById("app");

if (!target) throw new Error("Application mount element is missing.");

mount(App, { target });
