/**
 * Stub minimal de react-native pour le JEST des helpers purs.
 *
 * theme.ts lit `Platform.select` pour choisir l'ombre iOS / Android, mais ne
 * s'attend à RIEN d'autre de react-native. Plutôt que de monter le preset
 * jest-expo (disproportionné pour ces tests), on fournit ici le strict
 * minimum : un Platform qui se comporte comme sur iOS.
 */
export const Platform = {
  OS: 'ios',
  select: <T>(map: { [key: string]: T | undefined }): T | undefined => {
    if (map.ios !== undefined) return map.ios;
    return map.default;
  },
};