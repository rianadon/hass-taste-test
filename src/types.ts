export interface BrowserIntegration<E> {
    open(url: string): Promise<BrowserPage<E>>
    openInHeaded(url: string): Promise<void>
    close(): Promise<void>
}

export interface BrowserPage<E> {
    getNthCard(n: number): Promise<E>
    shadowHTML(element: E, options?: DiffOptions): Promise<string>
    textContent(element: E): Promise<string>
    screenshot(element: E): Promise<Buffer>
    find(element: E, selector: string): Promise<E | null | undefined>
}

interface IgnoreAttributesForTags {
  /** tags on which to ignore the given attributes */
  tags: string[]
  /** attributes to ignore for the given tags */
  attributes: string[]
}

export interface DiffOptions {
  /** array of attributes to ignore, when given a string that attribute will be ignored on all tags
   *  when given an object of type `IgnoreAttributesForTags`, you can specify on which tags to ignore which attributes */
  ignoreAttributes: (string | IgnoreAttributesForTags)[]
  /** array of tags to ignore, these tags are stripped from the output */
  ignoreTags: string[]
  /** array of tags whose children to ignore, the children of these tags are stripped from the output */
  ignoreChildren: string[]
  /** like ignoreChildren, but applies to shadow DOM rather than direct descendants */
  ignoreShadowChildren: string[]
  /** array of attributes which should be removed when empty.
   * Be careful not to add any boolean attributes here (e.g. `hidden`) unless you know what you're doing */
  stripEmptyAttributes: string[]
  /** whether to strip attributes from Lit & Polymer with undefined values */
  stripUndefinedAttributes: boolean
}


export type LovelaceResourceType = "css" | "js" | "module" | "html"

export interface LovelacePanelConfig {
  mode: "yaml" | "storage";
}

export interface LovelaceConfig {
  title?: string;
  strategy?: {
    type: string;
    options?: Record<string, unknown>;
  };
  views: LovelaceViewConfig[];
  background?: string;
}

export interface LegacyLovelaceConfig extends LovelaceConfig {
  resources?: LovelaceResource[];
}

export interface LovelaceResource {
  id: string;
  type: "css" | "js" | "module" | "html";
  url: string;
}

export interface LovelaceResourcesMutableParams {
  res_type: LovelaceResource["type"];
  url: string;
}

export type LovelaceDashboard =
  | LovelaceYamlDashboard
  | LovelaceStorageDashboard;

interface LovelaceGenericDashboard {
  id: string;
  url_path: string;
  require_admin: boolean;
  show_in_sidebar: boolean;
  icon?: string;
  title: string;
}

export interface LovelaceYamlDashboard extends LovelaceGenericDashboard {
  mode: "yaml";
  filename: string;
}

export interface LovelaceStorageDashboard extends LovelaceGenericDashboard {
  mode: "storage";
}

export interface LovelaceDashboardMutableParams {
  require_admin: boolean;
  show_in_sidebar: boolean;
  icon?: string;
  title: string;
}

export interface LovelaceDashboardCreateParams
  extends LovelaceDashboardMutableParams {
  url_path: string;
  mode: "storage";
}

export interface LovelaceViewConfig {
  index?: number;
  title?: string;
  type?: string;
  strategy?: {
    type: string;
    options?: Record<string, unknown>;
  };
  badges?: Array<string | LovelaceBadgeConfig>;
  cards?: LovelaceCardConfig[];
  path?: string;
  icon?: string;
  theme?: string;
  panel?: boolean;
  background?: string;
  visible?: boolean | ShowViewConfig[];
}

export interface ShowViewConfig {
  user?: string;
}

export interface LovelaceBadgeConfig {
  type?: string;
  [key: string]: any;
}

export interface LovelaceCardConfig {
  index?: number;
  view_index?: number;
  view_layout?: any;
  type: string;
  [key: string]: any;
}

export interface ToggleActionConfig extends BaseActionConfig {
  action: "toggle";
}

export interface NavigateActionConfig extends BaseActionConfig {
  action: "navigate";
  navigation_path: string;
}

export interface UrlActionConfig extends BaseActionConfig {
  action: "url";
  url_path: string;
}

export interface MoreInfoActionConfig extends BaseActionConfig {
  action: "more-info";
}

export interface NoActionConfig extends BaseActionConfig {
  action: "none";
}

export interface CustomActionConfig extends BaseActionConfig {
  action: "fire-dom-event";
}

export interface BaseActionConfig {
  confirmation?: ConfirmationRestrictionConfig;
}

export interface ConfirmationRestrictionConfig {
  text?: string;
  exemptions?: RestrictionConfig[];
}

export interface RestrictionConfig {
  user: string;
}
