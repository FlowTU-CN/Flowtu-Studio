export function inScoringWorkspace(): boolean {
    return document.documentElement.classList.contains('ft-scoring-open')
}
