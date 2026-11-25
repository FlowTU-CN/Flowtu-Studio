import {FRAME_RATES} from "@/flowtu/time-format"

export const rulerNames = {
    loop: "Work Area / Loop", notes: "Notes", seconds: "Seconds", timecode: "Timecode",
    samples: "Samples", user: "User frame rate"
} as const
export type RulerId = keyof typeof rulerNames
export type ClockRulerId = Exclude<RulerId, "loop" | "notes">
const storageKey = "flowtu.arrangementRulers.v1"

// Ruler visibility is a workstation preference. Notes themselves are part of the project.
export class RulerPreferences extends EventTarget {
    readonly visible: Record<RulerId, boolean> = {
        loop: true, notes: false, seconds: true, timecode: true, samples: false, user: false
    }
    userRate = "60"

    constructor() {
        super()
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null")
            if (!saved) {return}
            for (const id of Object.keys(rulerNames) as RulerId[]) {
                if (typeof saved.visible?.[id] === "boolean") {this.visible[id] = saved.visible[id]}
            }
            if (FRAME_RATES.some(rate => rate.id === saved.userRate)) {this.userRate = saved.userRate}
        } catch { /* The controls also work without local storage. */ }
    }

    show(id: RulerId, visible: boolean) {
        this.visible[id] = visible
        this.changed()
    }

    setUserRate(rate: string) {
        this.userRate = rate
        this.visible.user = true
        this.changed()
    }

    watch(update: () => void) {
        this.addEventListener("change", update)
        update()
        return {terminate: () => this.removeEventListener("change", update)}
    }

    private changed() {
        try {localStorage.setItem(storageKey, JSON.stringify({visible: this.visible, userRate: this.userRate}))} catch {}
        this.dispatchEvent(new Event("change"))
    }
}
