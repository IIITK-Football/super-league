import { THIRD_PLACE_LOOKUP } from "./thirdPlaceLookup";
import { FIXED_MATCHES } from "./fixedMatches";

export function getCombination(
    advancingThirdPlaceGroups: readonly string[]
): keyof typeof THIRD_PLACE_LOOKUP {
    return [...advancingThirdPlaceGroups]
        .sort()
        .join("") as keyof typeof THIRD_PLACE_LOOKUP;
}

export function getOpponent(
    advancingThirdPlaceGroups: readonly string[],
    team: string
): string | undefined {
    const combination =
        getCombination(advancingThirdPlaceGroups);

    const lookup =
        THIRD_PLACE_LOOKUP[combination];

    if (lookup && team in lookup) {
        return lookup[
            team as keyof typeof lookup
        ];
    }

    if (team in FIXED_MATCHES) {
        return FIXED_MATCHES[
            team as keyof typeof FIXED_MATCHES
        ];
    }

    return undefined;
}
