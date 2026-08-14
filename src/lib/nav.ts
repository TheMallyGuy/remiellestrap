export type PageId =
  | "home"
  | "appearance"
  | "behaviour"
  | "fastflags"
  | "mods"
  | "integrations"
  | "installation"
  | "about";

export interface NavItem {
  id: PageId;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home" },
  { id: "appearance", label: "Appearance" },
  { id: "behaviour", label: "Behaviour" },
  { id: "fastflags", label: "FastFlags" },
  { id: "mods", label: "Mods" },
  { id: "integrations", label: "Integrations" },
  { id: "installation", label: "Installation" },
  { id: "about", label: "About" },
];
