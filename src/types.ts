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

export type DashboardOptions = Partial<{
    colorScheme: 'light' | 'dark' | 'no-preference'
    title: string
}>

export interface BrowserIntegration<E> {
    open(url: string, options: DashboardOptions): Promise<BrowserPage<E>>
    openInHeaded(url: string): Promise<void>
    close(): Promise<void>
}

export interface BrowserPage<E> {
    getNthCard(n: number): Promise<E>
    shadowHTML(element: E, options?: Partial<DiffOptions>): Promise<string>
    textContent(element: E): Promise<string>
    screenshot(element: E): Promise<Buffer>
    find(element: E, selector: string): Promise<E | null | undefined>
}

export type LovelaceResourceType = 'css' | 'js' | 'module' | 'html'

export interface LovelaceDashboardMutableParams {
    require_admin: boolean
    show_in_sidebar: boolean
    icon?: string
    title: string
}

export interface LovelaceDashboardCreateParams extends LovelaceDashboardMutableParams {
    url_path: string
    mode: 'storage'
}
