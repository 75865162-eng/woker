import { redirect } from "next/navigation";

/**
 * Compatibility alias: the workspace home moved to the pinyin route
 * `/tiaotiao` (条条). Keep `/erp` working for existing bookmarks and links.
 */
export default function LegacyErpHomePage() {
  redirect("/tiaotiao");
}
