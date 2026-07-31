import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSession } from "../src/capture.js";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  close: vi.fn(async () => {}),
  cookies: vi.fn(async () => [
    {
      name: "session",
      value: "synthetic",
      domain: "service.example",
      path: "/",
    },
  ]),
}));

vi.mock("puppeteer-core", () => ({
  default: { launch: mocks.launch },
}));

describe("session capture cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const page = {
      evaluateOnNewDocument: vi.fn(async () => {}),
      goto: vi.fn(async () => {}),
      cookies: mocks.cookies,
    };
    mocks.launch.mockResolvedValue({
      pages: vi.fn(async () => [page]),
      newPage: vi.fn(async () => page),
      close: mocks.close,
    });
  });

  it("does not launch when already canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      captureSession({
        loginUrl: "https://service.example/login",
        cookieOrigin: "https://service.example",
        provider: "test",
        serviceName: "Test Service",
        profileDir: "/tmp/test-profile",
        isSignedIn: async () => false,
        signal: controller.signal,
      }),
    ).rejects.toThrow("sign-in was canceled");
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("closes the browser and returns no cookies when canceled while polling", async () => {
    const controller = new AbortController();
    const capture = captureSession({
      loginUrl: "https://service.example/login",
      cookieOrigin: "https://service.example",
      provider: "test",
      serviceName: "Test Service",
      profileDir: "/tmp/test-profile",
      pollMs: 60_000,
      isSignedIn: async () => false,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(capture).rejects.toThrow("sign-in was canceled");
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});
