import { describe, expect, it } from "vitest";
import { displayPath } from "./paths";

describe("displayPath", () => {
  it("shows paths under the home folder with ~", () => {
    expect(displayPath("C:\\Users\\ada\\Documents\\Qrabbit\\RL", "C:\\Users\\ada")).toBe("~\\Documents\\Qrabbit\\RL");
    expect(displayPath("c:\\users\\ADA\\Notes", "C:\\Users\\ada")).toBe("~\\Notes");
    expect(displayPath("/home/ada/papers", "/home/ada")).toBe("~/papers");
    expect(displayPath("/home/ada", "/home/ada/")).toBe("~");
  });

  it("leaves other paths, and look-alike prefixes, alone", () => {
    expect(displayPath("C:\\Users\\adam\\x", "C:\\Users\\ada")).toBe("C:\\Users\\adam\\x");
    expect(displayPath("D:\\papers", "C:\\Users\\ada")).toBe("D:\\papers");
    expect(displayPath("/home/ada/x", "")).toBe("/home/ada/x");
  });
});
