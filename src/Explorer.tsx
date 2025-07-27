import { App, FileView, requireApiVersion, TAbstractFile, TFile, TFolder, View, WorkspaceLeaf } from "./obsidian.ts";
import { list, el, mount, unmount } from "redom";
import { ContextMenu } from "./ContextMenu.ts";
import { FolderMenu } from "./FolderMenu.ts";
import { onElement, PerWindowComponent, statusBarItem } from "@ophidian/core";

export const hoverSource = "quick-explorer:folder-menu";

declare module "obsidian" {
    interface App {
        dragManager: any
        getAppTitle(prefix?: string): string;
    }
}

export function startDrag(app: App, path: string, event: DragEvent) {
    if (!path || path === "/") return;
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) return;
    const { dragManager } = app;
    const dragData = file instanceof TFile ? dragManager.dragFile(event, file) : dragManager.dragFolder(event, file);
    dragManager.onDragStart(event, dragData);
}

class Explorable {
    nameEl = <span class="explorable-name"/>;
    sepEl = <span class="explorable-separator"/>;
    el = <span draggable class="explorable titlebar-button">{this.nameEl}{this.sepEl}</span>;
    update(data: {file: TAbstractFile, path: string}, index: number, items: any[]) {
        const {file, path} = data;
        let name = file.name || path;
        this.sepEl.toggle(index < items.length-1);
        this.nameEl.textContent = name;
        this.el.dataset.parentPath = file.parent?.path ?? "/";
        this.el.dataset.filePath = path;
    }
}

export class Explorer extends PerWindowComponent {
    lastFile: TAbstractFile = null;
    lastPath: string = null;
    lastMenu: FolderMenu;

    el: HTMLElement = <div id="quick-explorer" />;
    list = list(this.el, Explorable);
    isOpen = 0
    app = app;

    onload() {
        // Try to close any open menu before unloading
        this.register(() => this.lastMenu?.hide());
        // Titlebar text replacement removed - using native titlebar stats

        if (requireApiVersion("0.16.0")) this.win.document.body.addClass("obsidian-themepocalypse");

        if (requireApiVersion("0.16.3")) {
            const selector = ".view-header .view-header-breadcrumb, .view-header .view-header-title-parent";
            this.register(onElement(this.win.document.body, "click", selector, (e, target) => {
                // Ignore if separator, or if a menu is already open for the item (.is-exploring)
                // (This allows double-click to open the file explorer)
                if ((e.target as HTMLElement).matches(".view-header-breadcrumb-separator, .is-exploring")) return;
                tabCrumb(target)?.open(e);
                e.stopPropagation();
                return false;
            }, {capture: true}));
            this.register(onElement(
                this.win.document.body, "contextmenu", ".view-header .view-header-breadcrumb", (e, target) => {
                    if ((e.target as HTMLElement).matches(".view-header-breadcrumb-separator")) return;
                    const folder = tabCrumb(target)?.file?.parent;
                    if (folder) {
                        new ContextMenu(this.app, folder).cascade(target, e);
                        e.stopImmediatePropagation();
                        return false;
                    }
                }, {capture: true}
            ));
        }

        // Path bar removed - using native breadcrumbs only

        // Path bar update removed - using native breadcrumbs only

        this.registerEvent(this.app.vault.on("rename", this.onFileChange, this));
        this.registerEvent(this.app.vault.on("delete", this.onFileDelete, this));

        // Custom path bar event handlers removed - using native breadcrumbs only
    }

    onFileChange(file: TAbstractFile) {
        // File change handling removed - using native breadcrumbs only
    }

    onFileDelete(file: TAbstractFile) {
        // File delete handling removed - using native breadcrumbs only
    }

    visibleCrumb(opener: HTMLElement) {
        let crumb = explorableCrumb(this, opener);
        if (!opener.isShown()) {
            const altOpener = app.workspace.getActiveViewOfType(View).containerEl.find(
                ".view-header .view-header-title-parent"
            );
            if (altOpener?.isShown()) {
                const {file} = crumb;
                crumb = tabCrumb(altOpener);
                crumb = crumb.peers.find(c => c.file === file) || crumb;
            }
        }
        return crumb;
    }

    folderMenu(opener: HTMLElement = this.el.firstElementChild as HTMLElement, event?: MouseEvent) {
        return this.lastMenu =  this.visibleCrumb(opener)?.open(event);
    }

    browseVault() {
        return this.folderMenu();
    }

    browseCurrent() {
        return this.folderMenu(this.el.lastElementChild as HTMLDivElement);
    }

    browseFile(file: TAbstractFile) {
        if (file === this.lastFile) return this.browseCurrent();
        let menu: FolderMenu;
        let opener: HTMLElement = this.el.firstElementChild as HTMLElement;
        const path = [], parts = file.path.split("/").filter(p=>p);
        while (opener && parts.length) {
            path.push(parts[0]);
            if (opener.dataset.filePath !== path.join("/")) {
                menu = this.folderMenu(opener);
                path.pop();
                break
            }
            parts.shift();
            opener = opener.nextElementSibling as HTMLElement;
        }
        while (menu && parts.length) {
            path.push(parts.shift());
            const idx = menu.itemForPath(path.join("/"));
            if (idx == -1) break
            menu.select(idx);
            if (parts.length || file instanceof TFolder) {
                menu.onArrowRight();
                menu = menu.child as FolderMenu;
            }
        }
        return menu;
    }

    isCurrent() {
        return this === this.use(Explorer).forLeaf(app.workspace.activeLeaf);
    }

    update(file?: TAbstractFile) {
        // Path bar update removed - using native breadcrumbs only
    }

}

export class Breadcrumb {
    constructor(
        public peers: Breadcrumb[],
        public el: HTMLElement,
        public file: TAbstractFile,
        public onOpen?: (crumb: Breadcrumb) => any,
        public onClose?: (crumb: Breadcrumb) => any,
    ) {
        peers.push(this);
    }
    next() {
        const i = this.peers.indexOf(this);
        if (i>-1) return this.peers[i+1];
    }
    prev() {
        const i = this.peers.indexOf(this);
        if (i>0) return this.peers[i-1];
    }
    open(e?: MouseEvent) {
        const selected = this.file;
        if (selected) {
            this.onOpen?.(this)
            const folder = this.file.parent || selected as TFolder;
            return new FolderMenu(app, folder, selected, this).cascade(
                this.el, e && e.isTrusted && e, () => this.onClose(this)
            );
        }
    }
}

function tabCrumb(opener: HTMLElement) {
    const crumbs: Breadcrumb[] = [];
    const leafEl = opener.matchParent(".workspace-leaf");
    let leaf: WorkspaceLeaf, crumb: Breadcrumb;
    app.workspace.iterateAllLeaves(l => l.containerEl === leafEl && (leaf = l) && true);
    const root = app.vault.getAbstractFileByPath("/");
    const file = (leaf?.view as FileView)?.file ?? root;
    const tree = hierarchy(file);
    const parent = opener.matchParent(".view-header-title-parent");
    crumb = new Breadcrumb(crumbs, parent as HTMLElement, tree.shift()?.file ?? root, onOpen, onClose);
    for (const el of parent.findAll(".view-header-breadcrumb")) {
        new Breadcrumb(crumbs, el, tree.shift()?.file ?? root, onOpen, onClose);
        if (el === opener) crumb = crumbs[crumbs.length-1];
    }
    return crumb;
    function onOpen(crumb: Breadcrumb) { crumb.el.toggleClass("is-exploring", true); }
    function onClose(crumb: Breadcrumb) { crumb.el.toggleClass("is-exploring", false); }
}

function explorableCrumb(explorer: Explorer, opener: HTMLElement) {
    const crumbs: Breadcrumb[] = [];
    const parent = opener.matchParent("#quick-explorer");
    let crumb: Breadcrumb;
    for (const el of parent.findAll(".explorable")) {
        new Breadcrumb(crumbs, el, app.vault.getAbstractFileByPath(el.dataset.filePath), onOpen, onClose);
        if (el === opener) crumb = crumbs[crumbs.length-1];
    }
    return crumb;
    function onOpen() {
        explorer.isOpen++;
    }
    function onClose() {
        explorer.isOpen--;
        explorer.lastMenu = null;
        if (!explorer.isOpen && explorer.isCurrent()) explorer.update(app.workspace.getActiveFile());
    }
}

function hierarchy(file: TAbstractFile) {
    const parts = [];
    while (file) {
        parts.unshift({ file, path: file.path });
        file = file.parent;
    }
    if (parts.length > 1) parts.shift();
    return parts;
}
