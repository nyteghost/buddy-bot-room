"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";

const plugins = { cjk, code, math, mermaid };

/** The heavy part of a reply (Markdown, code highlighting, maths, diagrams). Loaded on demand by `MessageResponse` so the first screen does not wait for it. */
export default function MessageMarkdown(props: ComponentProps<typeof Streamdown>) {
  return <Streamdown plugins={plugins} {...props} />;
}
