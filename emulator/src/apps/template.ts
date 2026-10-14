import type { ControlSpec, FirmwareApp } from "../core/app";
import { baseLfoControls, platformSharedControls } from "./platform";

const controls: ControlSpec[] = [...baseLfoControls(), ...platformSharedControls()];

/** The repo's AppTemplate: audio passes straight through. Useful to verify the gain staging of the base platform. */
export class TemplateApp implements FirmwareApp {
  readonly id = "template";
  readonly name = "Template (passthrough)";
  readonly tagline = "Input to output, untouched by the app. Shows the base platform gain staging only.";
  readonly firmwareId = "template";
  readonly controls = controls;
  readonly jacks = [];
  readonly leds = [];
  readonly stages = [
    { name: "Input", detail: "SHIFT+K1 input gain", keys: ["input_gain"] },
    { name: "App", detail: "passthrough", keys: [] },
    { name: "Output", detail: "SHIFT+K5 output gain", keys: ["output_gain"] },
  ];
  readonly presets = [{ name: "Init", values: {} }];
  readonly hasBypass = false;
  readonly buttons = { shift: "SHIFT reaches the base input/output gain.", mode: "MODE does nothing in this app." };
}
