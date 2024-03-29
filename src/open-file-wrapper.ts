import { around } from "monkey-around";
import type CST from "./main";
import { WorkspaceLeaf } from "obsidian";
import { Console } from "./Console";

export function openFileWrapper(plugin: CST) {
    const openFilePatched = around(WorkspaceLeaf.prototype, {
        //@ts-ignore
        openFile(old) {
            return async function (...args) {
                if (!plugin.settings.switch || plugin.link) {
                    return old.apply(this, args);
                }

                Console.debug("Open File");
                const [file, state] = args;
                Console.debug("args", args)
                Console.debug("state", state)
                const activeLeaf = plugin.getVisibleLeaf()
                Console.debug("getVisibleLeaf", activeLeaf?.getDisplayText())
                // plugin.activeLeafInfo()
                const target = file.path

                if (activeLeaf?.getDisplayText() === "Files") {
                    Console.debug("EXPLORER")
                    const activeLeaf = plugin.app.workspace.getMostRecentLeaf()
                    Console.log("activeLeaf", activeLeaf?.getDisplayText())
                    const { empties, duplis } = init(activeLeaf!, args, plugin)

                    if (!duplis) {
                        Console.debug("normal pinned")
                        const result = old.apply(this, args)
                        return result
                    }

                    Console.debug("duplis")
                    // I separate each situation, even if code repetition, because it's complex to cover all
                    if (plugin.ctrl || plugin.middleClick) {//on existing tab+ ctrl
                        Console.debug("ctrl || middle click")
                        await activateDetach(plugin, duplis, empties, 10)
                    } else { // drag/insert
                        if (state?.active === false) { //ok
                            Console.debug("drag/insert")
                            await activateDetach(plugin, duplis, empties, 10)
                            return
                        } else {//on existing tab or new window
                            Console.debug("drag on existing tab or popout")
                            if (plugin.getLeafPath(activeLeaf!) !== target && !plugin.getPinned(duplis))//don't close actual leaf as dupli
                            {
                                Console.log("detach")
                                await activateDetach(plugin, duplis, activeLeaf!, 10)
                            } else {
                                Console.log("normal")
                                return old.apply(this, args)
                            }
                        }
                    }
                } else if (state?.active === true || state?.eState) { // NOT EXPLORER
                    const activeLeaf = plugin.app.workspace.getLeaf()
                    Console.debug("quickswitch or drag on tab header")
                    const { empties, duplis, activeEl } = init(activeLeaf, args, plugin)

                    if (duplis) {
                        Console.debug("duplis")
                        if (plugin.ctrl || plugin.middleClick) {// quick switch ctrl
                            Console.debug("quick switch ctrl")
                            await activateDetach(plugin, duplis, empties, 10)
                            await removeEmpty(plugin, activeEl, 0)
                        }
                        else {// quick switch
                            Console.debug("quick switch or drag header or today note")
                            if (plugin.getLeafPath(activeLeaf) !== target) {
                                await activateDetach(plugin, duplis, activeLeaf, 10)}
                            if (state?.eState) await removeEmpty(plugin, activeEl, 0)
                        }
                    } else { // today note no existing tab. quick switcher pinned tab
                        Console.debug("// today note no existing tab. quick switcher pinned tab")
                        const mostRecentLeaf = plugin.app.workspace.getMostRecentLeaf()
                        if (plugin.getPinned(mostRecentLeaf!)) {
                            await removeEmpty(plugin, activeEl, 0)
                        }
                        old.apply(this, args)
                        // return result
                    }
                } else if (state?.active === false) {// draggin/insert
                    const { empties, duplis, activeEl } = init(activeLeaf, args, plugin)
                    const isMainWindow = activeLeaf?.view.containerEl.win === window;
                    if (isMainWindow) {
                        if (state.hasOwnProperty('state')) {
                            Console.log("Hover editor")
                            return old.apply(this, args)
                        }
                        Console.log("isMainWindow")
                        Console.log("marqueur")
                        empties?.pop()?.detach()
                        await activateLeaf(plugin, duplis, 0)
                    } else { // drag on other window
                        Console.log("drag on other window")
                        if (duplis) {
                            if (!plugin.getPinned(duplis)) {
                                Console.log("not pinned")
                                await activateLeaf(plugin, duplis, 0)
                                await removeEmpty(plugin, activeEl, 0);// back into the future ...
                            } else {
                                Console.log("pinned")
                                return old.apply(this, args)
                            }
                        } else {
                            return old.apply(this, args)
                        }
                    }
                    // await activateLeaf(plugin, duplis, 0)
                } else {// open window normal
                    Console.log("open window normal")
                    return old.apply(this, args)
                }
            };
        },
    });
    return openFilePatched;
}

function init(activeLeaf: WorkspaceLeaf | null, args: any, plugin: CST) {
    const [file, state] = args;
    const target = file.path
    const {
        activeEl,
        leaves,
        empties,
        isTherePin
    } = getConditions(plugin, activeLeaf)
    const duplis = leaves.filter(l => { return plugin.getLeafPath(l) === target })[0]
    Console.debug("duplis.length", leaves.filter(l => { return plugin.getLeafPath(l) === target }).length)
    Console.debug("leaves.length", leaves.length)
    Console.debug("empties.length", empties.length)
    return {
        activeEl,
        leaves,
        empties,
        isTherePin,
        duplis
    }
}

function removeEmpty(plugin: CST, activeEl: HTMLElement | null, timeout: number): Promise<void> {
    return delayedPromise<void>(timeout, () => {
        const { empties } = plugin.getLeaves(activeEl as HTMLElement)
        Console.debug("Detaching leaf");
        empties?.pop()?.detach();
    });
}

async function activateDetach(plugin: CST, leafToActivate: WorkspaceLeaf, toDetach: WorkspaceLeaf[] | WorkspaceLeaf, timeout: number) {
    await activateLeaf(plugin, leafToActivate, timeout)
    if (Array.isArray(toDetach!)) toDetach.pop()?.detach()
    else toDetach.detach()
}

// I do a promise with a timer could avoid bugs
function activateLeaf(plugin: CST, leaf: WorkspaceLeaf, timeout: number): Promise<void> {
    return delayedPromise<void>(timeout, () => {
        Console.debug("activating leaf")
        plugin.app.workspace.setActiveLeaf(leaf, { focus: true })
    });
}

function delayedPromise<T>(timeout: number, callback: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
        setTimeout(() => {
            const result = callback();
            resolve(result);
        }, timeout);
    });
}

function getConditions(plugin: CST, activeLeaf: WorkspaceLeaf | null): { activeLeaf: WorkspaceLeaf | null, activeEl: HTMLElement, leaves: WorkspaceLeaf[], empties: WorkspaceLeaf[], isTherePin: boolean } {
    const { el: activeEl } = plugin.getLeafProperties(activeLeaf);
    const { leaves, empties, isTherePin } = plugin.getLeaves(activeEl!);
    return { activeLeaf, activeEl, leaves, empties, isTherePin }
}

