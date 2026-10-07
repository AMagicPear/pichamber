import { expect, test } from "bun:test";
import { messageImages } from "./messageContent";
import { toolBody } from "./toolBody";

test("tool images preserve accompanying text in live and finalized results", () => {
  const images = messageImages({ content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] });
  for (const toolName of ["codemode", "mcp__fixture__image", "read_mcp_resource", "custom_image_tool"]) {
    expect(toolBody({ toolName, output: "saved image path", images })).toEqual({ kind: "images", content: "saved image path", images });
  }
  expect(toolBody({ toolName: "read", args: { path: "a.png" }, output: "Read image", images })).toEqual({ kind: "images", content: undefined, images });
});
