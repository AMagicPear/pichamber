/**
 * Shared code used by both @pichamber/web and @pichamber/server.
 *
 * Keep this package framework-agnostic: no Vue, no Node-only APIs, no DOM globals.
 * Anything in here should be importable from any TS project (browser, server, edge).
 */

export const APP_NAME = "pichamber";
