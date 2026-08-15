export function formatKMG(value: number): string {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) {
        return (value / 1_000_000_000).toPrecision(4).replace(/\.0+$/, '') + 'G';
    }
    if (abs >= 1_000_000) {
        return (value / 1_000_000).toPrecision(4).replace(/\.0+$/, '') + 'M';
    }
    if (abs >= 1_000) {
        return (value / 1_000).toPrecision(4).replace(/\.0+$/, '') + 'K';
    }
    return value.toString();
}
