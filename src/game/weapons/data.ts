// The arsenal. Every firearm is one row of real-world specifications; damage, recoil, handling,
// range and sound are all DERIVED from those numbers (see derive()), so adding a weapon is one line.
//
// Row: [id, name, class, country, year, caliber, mass kg, length mm, barrel mm, rpm, muzzle m/s, capacity, modes, look, extra?]
// modes: a=auto s=semi b2/b3=burst bolt pump lever da/sa=revolver single
// look:  "<style> <options...>" consumed by the procedural model builder.

import { clamp, clamp01 } from '../../core/math';
import type { Caliber, Feed, FireMode, Projectile, SoundClass, WeaponClass, WeaponDef } from './types';

const COUNTRY: Record<string, string> = {
  US: 'United States', SU: 'Soviet Union', RU: 'Russia', DE: 'Germany', GB: 'United Kingdom', FR: 'France', IT: 'Italy', BE: 'Belgium',
  AT: 'Austria', CH: 'Switzerland', IL: 'Israel', CZ: 'Czech Republic', CS: 'Czechoslovakia', CN: 'China', JP: 'Japan', KR: 'South Korea',
  IN: 'India', AU: 'Australia', CA: 'Canada', SE: 'Sweden', FI: 'Finland', PL: 'Poland', YU: 'Yugoslavia', ZA: 'South Africa',
  SG: 'Singapore', BR: 'Brazil', TR: 'Turkey', NL: 'Netherlands', ID: 'Indonesia', NP: 'Nepal', LA: 'Latin America', RO: 'Roman Republic',
  ES: 'Spain', HR: 'Croatia', HU: 'Hungary', DK: 'Denmark', EG: 'Egypt', TW: 'Taiwan',
};

export const CALIBERS: Record<string, Caliber> = {
  '.22lr': { label: '.22 LR', g: 2.6, k: 0.003, pen: 0.012 },
  '.32acp': { label: '.32 ACP', g: 4.6, k: 0.0028, pen: 0.015 },
  '.380': { label: '.380 ACP', g: 6.2, k: 0.0027, pen: 0.018 },
  '9x18': { label: '9×18mm Makarov', g: 6.1, k: 0.0026, pen: 0.02 },
  '9x19': { label: '9×19mm Parabellum', g: 8.0, k: 0.0022, pen: 0.03 },
  '.45acp': { label: '.45 ACP', g: 14.9, k: 0.002, pen: 0.028 },
  '.45colt': { label: '.45 Colt', g: 16.2, k: 0.0022, pen: 0.03 },
  '.455': { label: '.455 Webley', g: 17.2, k: 0.0024, pen: 0.022 },
  '.38spl': { label: '.38 Special', g: 10.2, k: 0.0024, pen: 0.022 },
  '.357': { label: '.357 Magnum', g: 10.2, k: 0.0022, pen: 0.045 },
  '.44mag': { label: '.44 Magnum', g: 15.6, k: 0.002, pen: 0.055 },
  '.454': { label: '.454 Casull', g: 19.4, k: 0.002, pen: 0.065 },
  '.500sw': { label: '.500 S&W Magnum', g: 22.7, k: 0.0019, pen: 0.07 },
  '.50ae': { label: '.50 Action Express', g: 19.4, k: 0.002, pen: 0.06 },
  '7.62x25': { label: '7.62×25mm Tokarev', g: 5.5, k: 0.0024, pen: 0.04 },
  '7.63x25': { label: '7.63×25mm Mauser', g: 5.5, k: 0.0024, pen: 0.04 },
  '7.62x38r': { label: '7.62×38mmR Nagant', g: 6.3, k: 0.0026, pen: 0.02 },
  '8x22': { label: '8×22mm Nambu', g: 6.6, k: 0.0027, pen: 0.018 },
  '5.7x28': { label: '5.7×28mm', g: 2.0, k: 0.0024, pen: 0.06 },
  '4.6x30': { label: '4.6×30mm', g: 2.0, k: 0.0025, pen: 0.06 },
  '5.8x21': { label: '5.8×21mm DAP92', g: 3.0, k: 0.0025, pen: 0.05 },
  '9x39': { label: '9×39mm (subsonic)', g: 16.2, k: 0.0014, pen: 0.08 },
  '.300blk': { label: '.300 AAC Blackout', g: 14.3, k: 0.0012, pen: 0.05 },
  '5.45x39': { label: '5.45×39mm', g: 3.4, k: 0.0016, pen: 0.075 },
  '5.56x45': { label: '5.56×45mm NATO', g: 4.0, k: 0.0015, pen: 0.08 },
  '5.8x42': { label: '5.8×42mm DBP87', g: 4.15, k: 0.0014, pen: 0.085 },
  '6.8x51': { label: '6.8×51mm (.277 Fury)', g: 8.7, k: 0.0009, pen: 0.16 },
  '4.73x33': { label: '4.73×33mm caseless', g: 3.3, k: 0.0018, pen: 0.07 },
  '7.62x39': { label: '7.62×39mm', g: 7.9, k: 0.0017, pen: 0.1 },
  '7.92x33': { label: '7.92×33mm Kurz', g: 8.1, k: 0.0018, pen: 0.085 },
  '.30carbine': { label: '.30 Carbine', g: 7.1, k: 0.0022, pen: 0.05 },
  '.30-30': { label: '.30-30 Winchester', g: 9.7, k: 0.0019, pen: 0.09 },
  '.44-40': { label: '.44-40 Winchester', g: 13.0, k: 0.0024, pen: 0.035 },
  '.45-70': { label: '.45-70 Government', g: 26.2, k: 0.0017, pen: 0.09 },
  '6.5x50': { label: '6.5×50mmSR Arisaka', g: 9.0, k: 0.0011, pen: 0.11 },
  '6.5x52': { label: '6.5×52mm Carcano', g: 10.5, k: 0.0011, pen: 0.11 },
  '7.5x54': { label: '7.5×54mm French', g: 9.0, k: 0.001, pen: 0.14 },
  '7.5x55': { label: '7.5×55mm Swiss', g: 11.3, k: 0.0009, pen: 0.15 },
  '7.62x51': { label: '7.62×51mm NATO', g: 9.5, k: 0.001, pen: 0.15 },
  '7.62x54r': { label: '7.62×54mmR', g: 9.6, k: 0.001, pen: 0.15 },
  '7.7x58': { label: '7.7×58mm Arisaka', g: 11.3, k: 0.001, pen: 0.14 },
  '7.92x57': { label: '7.92×57mm Mauser', g: 12.8, k: 0.0009, pen: 0.16 },
  '8x50r': { label: '8×50mmR', g: 15.8, k: 0.0011, pen: 0.13 },
  '.303': { label: '.303 British', g: 11.3, k: 0.001, pen: 0.14 },
  '.30-06': { label: '.30-06 Springfield', g: 9.7, k: 0.001, pen: 0.16 },
  '.300wm': { label: '.300 Winchester Magnum', g: 12.3, k: 0.0007, pen: 0.2 },
  '.338lm': { label: '.338 Lapua Magnum', g: 16.2, k: 0.0006, pen: 0.26 },
  '.338nm': { label: '.338 Norma Magnum', g: 19.4, k: 0.0006, pen: 0.27 },
  '.408': { label: '.408 CheyTac', g: 27.2, k: 0.0005, pen: 0.34 },
  '.50bmg': { label: '.50 BMG (12.7×99mm)', g: 42.8, k: 0.0005, pen: 0.55 },
  '12.7x108': { label: '12.7×108mm', g: 48.3, k: 0.0005, pen: 0.55 },
  '.55boys': { label: '.55 Boys', g: 47.6, k: 0.0007, pen: 0.6 },
  '14.5x114': { label: '14.5×114mm', g: 64, k: 0.0005, pen: 0.8 },
  '20x82': { label: '20×82mm HEI', g: 110, k: 0.0007, pen: 1.0, blast: { r: 2.6, dmg: 90 } },
  '.577/450': { label: '.577/450 Martini-Henry', g: 31.1, k: 0.002, pen: 0.06 },
  '.75ball': { label: '.75 calibre ball', g: 32, k: 0.006, pen: 0.04 },
  '.58minie': { label: '.58 Minié ball', g: 32.4, k: 0.003, pen: 0.05 },
  '.50ball': { label: '.50 calibre patched ball', g: 11.5, k: 0.0055, pen: 0.03 },
  '12ga': { label: '12 gauge 00 buckshot', g: 3.5, k: 0.012, pen: 0.012, pellets: 9 },
  '23mm': { label: '23mm Shrapnel-25', g: 5.0, k: 0.012, pen: 0.015, pellets: 14 },
  blunder: { label: 'Loose shot', g: 3.0, k: 0.014, pen: 0.008, pellets: 12 },
  '40mm': { label: '40×46mm HE', g: 230, k: 0.0006, pen: 0, proj: 'grenade', blast: { r: 5.5, dmg: 170 } },
  '40vog': { label: '40mm VOG-25', g: 250, k: 0.0006, pen: 0, proj: 'grenade', blast: { r: 5.0, dmg: 160 } },
  '43mm': { label: '43mm VGM-93 thermobaric', g: 280, k: 0.0006, pen: 0, proj: 'grenade', blast: { r: 5.2, dmg: 200 } },
  '25mm': { label: '25×40mm airburst', g: 110, k: 0.0006, pen: 0, proj: 'grenade', blast: { r: 3.4, dmg: 115 } },
  pg7: { label: '85mm PG-7V HEAT', g: 2200, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 6.5, dmg: 420 } },
  '66mm': { label: '66mm HEAT', g: 1000, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 5.5, dmg: 330 } },
  '66inc': { label: '66mm M74 incendiary', g: 1360, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 6, dmg: 240, fire: true } },
  '84mm': { label: '84mm HEAT', g: 3000, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 7, dmg: 460 } },
  '83mm': { label: '83mm HEDP', g: 4400, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 7, dmg: 450 } },
  '110mm': { label: '110mm tandem HEAT', g: 3900, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 7.5, dmg: 520 } },
  pzf: { label: '149mm shaped charge', g: 2900, k: 0.0004, pen: 0, proj: 'rocket', blast: { r: 6, dmg: 380 } },
  '88mm': { label: '88mm RPzB.Gr. 4322', g: 3300, k: 0.0003, pen: 0, proj: 'rocket', blast: { r: 6.5, dmg: 420 } },
  '60mm': { label: '2.36in M6 rocket', g: 1550, k: 0.0003, pen: 0, proj: 'rocket', blast: { r: 5.5, dmg: 320 } },
  piat: { label: '83mm PIAT bomb', g: 1100, k: 0.0004, pen: 0, proj: 'rocket', blast: { r: 5.5, dmg: 330 } },
  '127mm': { label: '127mm tandem HEAT missile', g: 11800, k: 0.0001, pen: 0, proj: 'rocket', blast: { r: 8, dmg: 700 } },
  '70mm': { label: '70mm missile', g: 10100, k: 0.0001, pen: 0, proj: 'rocket', blast: { r: 5, dmg: 350 } },
  '105mm': { label: '105mm PG-29V tandem', g: 6700, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 7.5, dmg: 560 } },
  '150mm': { label: '150mm overfly top-attack', g: 6500, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 7.5, dmg: 620 } },
  '93mm': { label: '93mm thermobaric', g: 6500, k: 0.0002, pen: 0, proj: 'rocket', blast: { r: 10, dmg: 520, fire: true } },
  napalm: { label: 'Thickened fuel', g: 0, k: 0, pen: 0, proj: 'flame' },
  bolt: { label: '20in carbon bolt', g: 26, k: 0.004, pen: 0.01, mul: 5.5, proj: 'arrow' },
  arrow: { label: 'Broadhead arrow', g: 28, k: 0.004, pen: 0.008, mul: 7, proj: 'arrow' },
  taser: { label: 'Probe cartridge (50,000 V)', g: 1, k: 0.02, pen: 0, proj: 'taser' },
  flare: { label: '26.5mm signal flare', g: 60, k: 0.004, pen: 0, proj: 'flare', blast: { r: 2.2, dmg: 40, fire: true } },
};

interface Extra {
  feed?: Feed;
  cycle?: number;
  burstRpm?: number;
  slam?: boolean;
  spin?: number;
  boost?: number;
  disposable?: boolean;
  guided?: boolean;
  zoom?: number;
}
type Row = [string, string, WeaponClass, string, number, string, number, number, number, number, number, number, string, string, Extra?];

// prettier-ignore
const GUNS: Row[] = [
  // ------------------------------------------------------------------ HANDGUNS
  ['m1911', 'Colt M1911A1', 'handgun', 'US', 1911, '.45acp', 1.1, 216, 127, 0, 253, 7, 's', 'pistol wood hammer'],
  ['glock17', 'Glock 17', 'handgun', 'AT', 1982, '9x19', 0.625, 204, 114, 0, 375, 17, 's', 'pistol'],
  ['glock19', 'Glock 19', 'handgun', 'AT', 1988, '9x19', 0.595, 187, 102, 0, 370, 15, 's', 'pistol'],
  ['glock18', 'Glock 18C', 'handgun', 'AT', 1986, '9x19', 0.62, 186, 114, 1150, 375, 33, 'a s', 'pistol ext'],
  ['m9', 'Beretta 92FS (M9)', 'handgun', 'IT', 1975, '9x19', 0.95, 217, 125, 0, 381, 15, 's', 'pistol hammer'],
  ['p226', 'SIG Sauer P226', 'handgun', 'CH', 1984, '9x19', 0.964, 196, 112, 0, 350, 15, 's', 'pistol hammer'],
  ['m17', 'SIG Sauer P320 (M17)', 'handgun', 'US', 2014, '9x19', 0.83, 203, 119, 0, 365, 17, 's', 'pistol tan'],
  ['usp45', 'HK USP .45', 'handgun', 'DE', 1993, '.45acp', 0.789, 201, 112, 0, 270, 12, 's', 'pistol hammer'],
  ['mk23', 'HK Mk 23 SOCOM', 'handgun', 'DE', 1996, '.45acp', 1.21, 245, 149, 0, 260, 12, 's', 'pistol hammer sup'],
  ['fiveseven', 'FN Five-seveN', 'handgun', 'BE', 1998, '5.7x28', 0.61, 208, 122, 0, 650, 20, 's', 'pistol'],
  ['deagle', 'Desert Eagle Mark XIX', 'handgun', 'IL', 1983, '.50ae', 2.0, 273, 152, 0, 470, 7, 's', 'pistol hammer big'],
  ['cz75', 'CZ 75', 'handgun', 'CS', 1975, '9x19', 1.12, 206, 120, 0, 370, 16, 's', 'pistol hammer'],
  ['makarov', 'Makarov PM', 'handgun', 'SU', 1951, '9x18', 0.73, 161, 93.5, 0, 315, 8, 's', 'pistol hammer wood'],
  ['tt33', 'Tokarev TT-33', 'handgun', 'SU', 1933, '7.62x25', 0.854, 194, 116, 0, 420, 8, 's', 'pistol hammer'],
  ['ppk', 'Walther PPK', 'handgun', 'DE', 1931, '.380', 0.59, 155, 83, 0, 290, 7, 's', 'pistol hammer'],
  ['p38', 'Walther P38', 'handgun', 'DE', 1938, '9x19', 0.8, 216, 125, 0, 365, 8, 's', 'pistol hammer exposed'],
  ['luger', 'Luger P08', 'handgun', 'DE', 1908, '9x19', 0.871, 222, 100, 0, 350, 8, 's', 'pistol wood exposed'],
  ['hipower', 'Browning Hi-Power', 'handgun', 'BE', 1935, '9x19', 1.0, 197, 119, 0, 335, 13, 's', 'pistol wood hammer'],
  ['c96', 'Mauser C96', 'handgun', 'DE', 1896, '7.63x25', 1.13, 312, 140, 0, 425, 10, 's', 'pistol wood exposed c96', { feed: 'internal' }],
  ['p99', 'Walther P99', 'handgun', 'DE', 1997, '9x19', 0.63, 180, 102, 0, 375, 15, 's', 'pistol'],
  ['vp9', 'HK VP9', 'handgun', 'DE', 2014, '9x19', 0.72, 186, 104, 0, 360, 15, 's', 'pistol'],
  ['mp9s', 'S&W M&P9', 'handgun', 'US', 2005, '9x19', 0.68, 193, 108, 0, 360, 17, 's', 'pistol'],
  ['qsz92', 'QSZ-92', 'handgun', 'CN', 1998, '5.8x21', 0.76, 190, 111, 0, 480, 20, 's', 'pistol'],
  ['jericho', 'Jericho 941', 'handgun', 'IL', 1990, '9x19', 1.1, 207, 112, 0, 360, 16, 's', 'pistol hammer'],
  ['fnx45', 'FN FNX-45 Tactical', 'handgun', 'US', 2012, '.45acp', 0.94, 216, 135, 0, 270, 15, 's', 'pistol tan hammer dot'],
  ['nambu', 'Nambu Type 14', 'handgun', 'JP', 1925, '8x22', 0.9, 230, 117, 0, 290, 8, 's', 'pistol wood exposed'],
  ['rugermk4', 'Ruger Mark IV', 'handgun', 'US', 1949, '.22lr', 1.0, 249, 140, 0, 330, 10, 's', 'pistol exposed'],
  ['welrod', 'Welrod Mk II', 'handgun', 'GB', 1942, '.32acp', 1.09, 310, 83, 0, 280, 8, 'bolt', 'pistol exposed fat sup', { cycle: 1.0 }],
  ['tec9', 'Intratec TEC-9', 'handgun', 'US', 1985, '9x19', 1.23, 317, 127, 0, 360, 32, 's', 'pistol exposed c96 shroud'],
  ['aps', 'Stechkin APS', 'handgun', 'SU', 1951, '9x18', 1.22, 225, 140, 750, 340, 20, 'a s', 'pistol hammer'],
  ['b93r', 'Beretta 93R', 'handgun', 'IT', 1979, '9x19', 1.17, 240, 156, 1100, 375, 20, 'b3 s', 'pistol hammer ext'],
  ['saa', 'Colt Single Action Army', 'handgun', 'US', 1873, '.45colt', 1.05, 279, 140, 0, 290, 6, 'sa', 'revolver wood', { feed: 'gate' }],
  ['m29', 'S&W Model 29', 'handgun', 'US', 1955, '.44mag', 1.28, 305, 165, 0, 450, 6, 'da', 'revolver wood'],
  ['python', 'Colt Python', 'handgun', 'US', 1955, '.357', 1.1, 292, 152, 0, 440, 6, 'da', 'revolver wood rib'],
  ['sw500', 'S&W Model 500', 'handgun', 'US', 2003, '.500sw', 2.05, 381, 213, 0, 505, 5, 'da', 'revolver big rib'],
  ['nagant', 'Nagant M1895', 'handgun', 'RU', 1895, '7.62x38r', 0.8, 235, 114, 0, 272, 7, 'da', 'revolver wood', { feed: 'gate' }],
  ['webley', 'Webley Mk VI', 'handgun', 'GB', 1915, '.455', 1.1, 286, 152, 0, 190, 6, 'da', 'revolver wood'],
  ['mr73', 'Manurhin MR 73', 'handgun', 'FR', 1973, '.357', 0.95, 233, 102, 0, 400, 6, 'da', 'revolver wood'],
  ['rhino', 'Chiappa Rhino 60DS', 'handgun', 'IT', 2009, '.357', 0.94, 267, 152, 0, 440, 6, 'da', 'revolver bal rib'],
  ['m10', 'S&W Model 10', 'handgun', 'US', 1899, '.38spl', 0.9, 237, 102, 0, 300, 6, 'da', 'revolver wood'],
  ['ragingbull', 'Taurus Raging Bull', 'handgun', 'BR', 1997, '.454', 1.5, 305, 165, 0, 500, 5, 'da', 'revolver big rib'],
  ['glock26', 'Glock 26', 'handgun', 'AT', 1994, '9x19', 0.615, 163, 87, 0, 350, 10, 's', 'pistol'],
  ['glock21', 'Glock 21', 'handgun', 'AT', 1990, '.45acp', 0.745, 209, 117, 0, 250, 13, 's', 'pistol fat'],
  ['px4', 'Beretta Px4 Storm', 'handgun', 'IT', 2004, '9x19', 0.785, 192, 102, 0, 360, 17, 's', 'pistol'],
  ['cz52', 'CZ 52', 'handgun', 'CS', 1952, '7.62x25', 0.95, 209, 120, 0, 500, 8, 's', 'pistol hammer'],
  ['fn1910', 'FN Model 1910', 'handgun', 'BE', 1910, '.32acp', 0.59, 153, 88, 0, 290, 7, 's', 'pistol'],
  ['p30', 'HK P30', 'handgun', 'DE', 2006, '9x19', 0.74, 177, 98, 0, 360, 15, 's', 'pistol'],
  ['usp9', 'HK USP 9', 'handgun', 'DE', 1993, '9x19', 0.77, 194, 108, 0, 350, 15, 's', 'pistol'],
  ['p7', 'HK P7M8', 'handgun', 'DE', 1979, '9x19', 0.78, 171, 105, 0, 351, 8, 's', 'pistol'],
  ['gsh18', 'GSh-18', 'handgun', 'RU', 2000, '9x19', 0.59, 184, 103, 0, 420, 18, 's', 'pistol'],
  ['pl15', 'Lebedev PL-15', 'handgun', 'RU', 2015, '9x19', 0.99, 220, 127, 0, 420, 15, 's', 'pistol'],
  ['grach', 'MP-443 Grach', 'handgun', 'RU', 2003, '9x19', 0.95, 198, 113, 0, 420, 18, 's', 'pistol hammer'],
  ['sigp210', 'SIG P210', 'handgun', 'CH', 1949, '9x19', 0.9, 215, 120, 0, 335, 8, 's', 'pistol wood hammer'],
  ['type54', 'Norinco Type 54', 'handgun', 'CN', 1954, '7.62x25', 0.85, 195, 116, 0, 420, 8, 's', 'pistol hammer'],
  ['p10c', 'CZ P-10 C', 'handgun', 'CZ', 2017, '9x19', 0.74, 187, 102, 0, 360, 15, 's', 'pistol'],
  ['p365', 'SIG P365', 'handgun', 'US', 2018, '9x19', 0.5, 147, 78, 0, 340, 10, 's', 'pistol'],
  ['ots33', 'OTs-33 Pernach', 'handgun', 'RU', 1996, '9x18', 1.15, 223, 135, 850, 330, 18, 'a s', 'pistol ext'],
  ['m1917rev', 'S&W M1917', 'handgun', 'US', 1917, '.45acp', 1.02, 270, 140, 0, 232, 6, 'da', 'revolver wood'],
  ['sw686', 'S&W Model 686', 'handgun', 'US', 1981, '.357', 1.25, 305, 152, 0, 440, 6, 'da', 'revolver rib'],
  ['detective', 'Colt Detective Special', 'handgun', 'US', 1927, '.38spl', 0.6, 178, 51, 0, 215, 6, 'da', 'revolver wood'],
  ['anaconda', 'Colt Anaconda', 'handgun', 'US', 1990, '.44mag', 1.5, 295, 152, 0, 440, 6, 'da', 'revolver rib big'],
  ['gp100', 'Ruger GP100', 'handgun', 'US', 1985, '.357', 1.13, 240, 106, 0, 400, 6, 'da', 'revolver rib'],
  // ------------------------------------------------------------------ SUBMACHINE GUNS
  ['mp5', 'HK MP5A3', 'smg', 'DE', 1966, '9x19', 3.08, 700, 225, 800, 400, 30, 'a b3 s', 'smg curve tele'],
  ['mp5sd', 'HK MP5SD', 'smg', 'DE', 1974, '9x19', 3.4, 780, 146, 700, 285, 30, 'a s', 'smg curve tele sup'],
  ['mp5k', 'HK MP5K', 'smg', 'DE', 1976, '9x19', 2.0, 325, 115, 900, 375, 30, 'a s', 'smg curve nostock fgrip'],
  ['mp7', 'HK MP7A1', 'smg', 'DE', 2001, '4.6x30', 1.9, 638, 180, 950, 735, 40, 'a s', 'smg gripmag tele fgrip dot'],
  ['p90', 'FN P90', 'smg', 'BE', 1990, '5.7x28', 2.6, 500, 264, 900, 715, 50, 'a s', 'p90 dot'],
  ['uzi', 'IMI Uzi', 'smg', 'IL', 1954, '9x19', 3.5, 650, 260, 600, 400, 32, 'a s', 'smg gripmag wire'],
  ['microuzi', 'Micro Uzi', 'smg', 'IL', 1986, '9x19', 2.0, 486, 134, 1200, 350, 20, 'a s', 'smg gripmag wire'],
  ['mac10', 'Ingram MAC-10', 'smg', 'US', 1970, '.45acp', 2.84, 548, 146, 1090, 280, 30, 'a s', 'smg gripmag wire'],
  ['thompson', 'Thompson M1A1', 'smg', 'US', 1942, '.45acp', 4.5, 811, 267, 700, 285, 30, 'a s', 'smg wood'],
  ['tommy', 'Thompson M1928A1', 'smg', 'US', 1928, '.45acp', 4.9, 852, 267, 720, 285, 50, 'a s', 'smg wood drum fgrip brake'],
  ['mp40', 'MP 40', 'smg', 'DE', 1940, '9x19', 3.97, 833, 251, 520, 400, 32, 'a', 'smg fold longmag'],
  ['ppsh41', 'PPSh-41', 'smg', 'SU', 1941, '7.62x25', 3.63, 843, 269, 950, 488, 71, 'a s', 'smg wood drum shroud'],
  ['pps43', 'PPS-43', 'smg', 'SU', 1943, '7.62x25', 3.04, 820, 243, 650, 500, 35, 'a', 'smg curve fold shroud'],
  ['sten', 'Sten Mk II', 'smg', 'GB', 1941, '9x19', 3.2, 762, 196, 520, 365, 32, 'a s', 'smg tube side skel'],
  ['m3', 'M3 "Grease Gun"', 'smg', 'US', 1943, '.45acp', 3.7, 757, 203, 450, 280, 30, 'a', 'smg tube wire'],
  ['sterling', 'Sterling L2A3', 'smg', 'GB', 1953, '9x19', 2.7, 686, 196, 550, 390, 34, 'a s', 'smg tube side fold shroud'],
  ['vector', 'KRISS Vector', 'smg', 'US', 2009, '.45acp', 2.7, 617, 140, 1200, 280, 25, 'a b2 s', 'smg fold bal dot'],
  ['ump45', 'HK UMP45', 'smg', 'DE', 1999, '.45acp', 2.3, 690, 200, 600, 260, 25, 'a b2 s', 'smg fold'],
  ['bizon', 'PP-19 Bizon', 'smg', 'RU', 1996, '9x18', 2.1, 660, 230, 700, 320, 64, 'a s', 'ak helical fold'],
  ['vityaz', 'PP-19-01 Vityaz', 'smg', 'RU', 2008, '9x19', 2.9, 705, 237, 750, 380, 30, 'a s', 'ak fold'],
  ['skorpion', 'Škorpion vz. 61', 'smg', 'CS', 1961, '.32acp', 1.3, 517, 115, 850, 320, 20, 'a s', 'smg curve wire wood'],
  ['evo3', 'CZ Scorpion EVO 3', 'smg', 'CZ', 2009, '9x19', 2.77, 670, 196, 1150, 370, 30, 'a b3 s', 'smg curve fold'],
  ['mpx', 'SIG MPX', 'smg', 'US', 2013, '9x19', 2.7, 648, 203, 850, 370, 30, 'a s', 'ar tele rail dot'],
  ['m12', 'Beretta M12', 'smg', 'IT', 1959, '9x19', 3.48, 660, 200, 550, 380, 32, 'a s', 'smg tube fold fgrip'],
  ['owen', 'Owen Gun', 'smg', 'AU', 1942, '9x19', 4.21, 813, 247, 700, 380, 33, 'a', 'smg tube top wood fgrip'],
  ['f1smg', 'F1 submachine gun', 'smg', 'AU', 1963, '9x19', 3.26, 715, 198, 620, 366, 34, 'a', 'smg tube top'],
  ['suomi', 'Suomi KP/-31', 'smg', 'FI', 1931, '9x19', 4.6, 870, 314, 800, 396, 71, 'a s', 'smg wood drum shroud'],
  ['mat49', 'MAT-49', 'smg', 'FR', 1949, '9x19', 3.5, 720, 228, 600, 390, 32, 'a', 'smg tube wire'],
  ['mp18', 'MP 18', 'smg', 'DE', 1918, '9x19', 4.18, 832, 200, 500, 380, 32, 'a', 'smg wood side shroud'],
  ['type100', 'Type 100', 'smg', 'JP', 1942, '8x22', 3.7, 890, 228, 450, 335, 30, 'a', 'smg wood side shroud'],
  ['mp9', 'B&T MP9', 'smg', 'CH', 2001, '9x19', 1.4, 523, 130, 900, 370, 30, 'a s', 'smg gripmag fold fgrip'],
  ['pp2000', 'PP-2000', 'smg', 'RU', 2006, '9x19', 1.4, 555, 182, 700, 410, 20, 'a s', 'smg gripmag fold'],
  ['apc9', 'B&T APC9', 'smg', 'CH', 2011, '9x19', 2.5, 597, 175, 1080, 400, 30, 'a s', 'smg fold dot'],
  ['ump9', 'HK UMP9', 'smg', 'DE', 2000, '9x19', 2.35, 690, 200, 650, 400, 30, 'a b2 s', 'smg fold'],
  ['mac11', 'Ingram MAC-11', 'smg', 'US', 1972, '.380', 1.59, 531, 129, 1200, 300, 32, 'a s', 'smg wire gripmag'],
  ['ppd40', 'PPD-40', 'smg', 'SU', 1940, '7.62x25', 3.2, 788, 273, 800, 480, 71, 'a s', 'smg wood drum shroud'],
  ['beretta38', 'Beretta M38A', 'smg', 'IT', 1938, '9x19', 4.2, 946, 315, 600, 429, 30, 'a s', 'smg wood shroud'],
  ['lanchester', 'Lanchester Mk I', 'smg', 'GB', 1941, '9x19', 4.34, 851, 203, 600, 380, 50, 'a s', 'smg wood shroud side'],
  ['reising', 'Reising M50', 'smg', 'US', 1941, '.45acp', 3.1, 959, 279, 550, 280, 20, 'a s', 'smg wood'],
  ['sw76', 'S&W M76', 'smg', 'US', 1967, '9x19', 3.29, 762, 203, 720, 365, 36, 'a s', 'smg tube fold'],
  ['kpist45', 'Carl Gustaf m/45', 'smg', 'SE', 1945, '9x19', 3.35, 808, 212, 600, 425, 36, 'a', 'smg tube fold shroud'],
  ['madsen50', 'Madsen M-50', 'smg', 'DK', 1950, '9x19', 3.17, 800, 197, 550, 380, 32, 'a', 'smg fold'],
  ['pm63', 'PM-63 RAK', 'smg', 'PL', 1965, '9x18', 1.6, 583, 152, 650, 320, 25, 'a s', 'smg gripmag fold'],
  ['miniuzi', 'IMI Mini Uzi', 'smg', 'IL', 1980, '9x19', 2.7, 600, 197, 950, 375, 32, 'a s', 'smg gripmag fold'],
  ['tmp', 'Steyr TMP', 'smg', 'AT', 1992, '9x19', 1.3, 282, 130, 850, 380, 30, 'a s', 'smg gripmag fgrip nostock'],
  ['spectre', 'Spectre M4', 'smg', 'IT', 1984, '9x19', 2.9, 580, 130, 850, 400, 50, 'a s', 'smg fold fgrip'],
  ['jatimatic', 'Jatimatic', 'smg', 'FI', 1983, '9x19', 1.65, 375, 203, 650, 360, 40, 'a s', 'smg gripmag fgrip nostock'],
  ['k7', 'Daewoo K7', 'smg', 'KR', 2001, '9x19', 3.4, 788, 134, 1100, 295, 30, 'a b3 s', 'smg curve tele sup'],
  ['kedr', 'PP-91 Kedr', 'smg', 'RU', 1994, '9x18', 1.5, 530, 120, 800, 310, 30, 'a s', 'smg fold'],
  ['mp34', 'Steyr MP 34', 'smg', 'AT', 1934, '9x19', 4.25, 850, 200, 600, 410, 32, 'a s', 'smg wood shroud side'],
  // ------------------------------------------------------------------ ASSAULT RIFLES
  ['ak47', 'AK-47', 'assault', 'SU', 1949, '7.62x39', 3.47, 880, 415, 600, 715, 30, 'a s', 'ak wood curve'],
  ['akm', 'AKM', 'assault', 'SU', 1959, '7.62x39', 3.1, 880, 415, 600, 715, 30, 'a s', 'ak wood curve brake'],
  ['ak74', 'AK-74', 'assault', 'SU', 1974, '5.45x39', 3.07, 943, 415, 650, 900, 30, 'a s', 'ak wood curve brake'],
  ['ak74m', 'AK-74M', 'assault', 'RU', 1991, '5.45x39', 3.4, 943, 415, 650, 900, 30, 'a s', 'ak curve fold brake'],
  ['aks74u', 'AKS-74U', 'assault', 'SU', 1979, '5.45x39', 2.7, 730, 206, 700, 735, 30, 'a s', 'ak wood curve fold hider'],
  ['ak12', 'AK-12', 'assault', 'RU', 2018, '5.45x39', 3.5, 940, 415, 700, 900, 30, 'a b2 s', 'ak curve tele rail brake'],
  ['ak103', 'AK-103', 'assault', 'RU', 1994, '7.62x39', 3.4, 943, 415, 600, 715, 30, 'a s', 'ak curve fold brake'],
  ['an94', 'AN-94 Abakan', 'assault', 'RU', 1994, '5.45x39', 3.85, 943, 405, 600, 900, 30, 'a b2 s', 'ak curve fold bal', { burstRpm: 1800 }],
  ['aek971', 'AEK-971', 'assault', 'RU', 1990, '5.45x39', 3.3, 960, 420, 900, 880, 30, 'a b3 s', 'ak curve fold bal'],
  ['type56', 'Type 56', 'assault', 'CN', 1956, '7.62x39', 3.8, 874, 414, 650, 735, 30, 'a s', 'ak wood curve bayonet'],
  ['type81', 'Type 81', 'assault', 'CN', 1983, '7.62x39', 3.4, 955, 445, 700, 750, 30, 'a s', 'ak wood curve'],
  ['zm70', 'Zastava M70', 'assault', 'YU', 1970, '7.62x39', 3.7, 900, 415, 620, 720, 30, 'a s', 'ak wood curve'],
  ['rk62', 'Valmet Rk 62', 'assault', 'FI', 1965, '7.62x39', 3.5, 914, 420, 700, 715, 30, 'a s', 'ak curve skel'],
  ['vz58', 'vz. 58', 'assault', 'CS', 1959, '7.62x39', 2.91, 845, 390, 800, 705, 30, 'a s', 'ak wood curve'],
  ['galil', 'IMI Galil ARM', 'assault', 'IL', 1972, '5.56x45', 4.35, 979, 460, 650, 950, 35, 'a s', 'ak curve fold bipod wood'],
  ['r4', 'Vektor R4', 'assault', 'ZA', 1980, '5.56x45', 4.3, 1005, 460, 650, 980, 35, 'a s', 'ak curve fold bipod'],
  ['beryl', 'FB Beryl wz. 96', 'assault', 'PL', 1997, '5.56x45', 3.35, 943, 457, 700, 920, 30, 'a b3 s', 'ak curve fold rail'],
  ['insas', 'INSAS', 'assault', 'IN', 1998, '5.56x45', 4.02, 960, 464, 650, 900, 20, 'b3 s', 'ak wood clearmag'],
  ['m16a1', 'M16A1', 'assault', 'US', 1967, '5.56x45', 2.89, 986, 508, 750, 960, 20, 'a s', 'ar handle'],
  ['m16a2', 'M16A2', 'assault', 'US', 1983, '5.56x45', 3.4, 1006, 508, 800, 945, 30, 'b3 s', 'ar handle'],
  ['m16a4', 'M16A4', 'assault', 'US', 1998, '5.56x45', 3.4, 1003, 508, 800, 945, 30, 'b3 s', 'ar rail acog'],
  ['m4a1', 'M4A1', 'assault', 'US', 1994, '5.56x45', 2.88, 838, 368, 800, 880, 30, 'a s', 'ar tele rail dot'],
  ['mk18', 'Mk 18 CQBR', 'assault', 'US', 2000, '5.56x45', 2.72, 762, 262, 800, 790, 30, 'a s', 'ar tele rail holo fgrip tan'],
  ['xm177', 'Colt XM177E2', 'assault', 'US', 1967, '5.56x45', 2.44, 826, 292, 750, 838, 30, 'a s', 'ar handle tele hider'],
  ['c7', 'Colt Canada C7A2', 'assault', 'CA', 1984, '5.56x45', 3.3, 1006, 508, 800, 940, 30, 'a s', 'ar tele rail acog green'],
  ['hk416', 'HK416', 'assault', 'DE', 2004, '5.56x45', 3.49, 900, 368, 850, 890, 30, 'a s', 'ar tele rail holo fgrip'],
  ['qbz191', 'QBZ-191', 'assault', 'CN', 2019, '5.8x42', 3.25, 880, 368, 750, 900, 30, 'a s', 'ar tele rail dot'],
  ['honeybadger', 'AAC Honey Badger', 'assault', 'US', 2011, '.300blk', 2.9, 737, 152, 800, 315, 30, 'a s', 'ar tele rail sup dot'],
  ['g36', 'HK G36', 'assault', 'DE', 1997, '5.56x45', 3.63, 999, 480, 750, 920, 30, 'a b2 s', 'mod handle fold aug15 clearmag'],
  ['g36c', 'HK G36C', 'assault', 'DE', 2001, '5.56x45', 2.82, 720, 228, 750, 722, 30, 'a b2 s', 'mod fold rail clearmag'],
  ['scarl', 'FN SCAR-L (Mk 16)', 'assault', 'BE', 2009, '5.56x45', 3.29, 889, 351, 625, 870, 30, 'a s', 'mod fold rail tan dot'],
  ['fnc', 'FN FNC', 'assault', 'BE', 1979, '5.56x45', 3.84, 997, 450, 700, 965, 30, 'a b3 s', 'mod fold skel'],
  ['sg550', 'SIG SG 550', 'assault', 'CH', 1990, '5.56x45', 4.05, 998, 528, 700, 905, 30, 'a b3 s', 'mod fold bipod clearmag green'],
  ['sg552', 'SIG SG 552 Commando', 'assault', 'CH', 1998, '5.56x45', 3.2, 730, 226, 780, 725, 30, 'a b3 s', 'mod fold clearmag'],
  ['type89', 'Howa Type 89', 'assault', 'JP', 1989, '5.56x45', 3.5, 916, 420, 750, 920, 30, 'a b3 s', 'mod bipod'],
  ['k2', 'Daewoo K2', 'assault', 'KR', 1984, '5.56x45', 3.26, 980, 465, 750, 920, 30, 'a b3 s', 'mod fold'],
  ['arx160', 'Beretta ARX160', 'assault', 'IT', 2008, '5.56x45', 3.1, 920, 406, 700, 920, 30, 'a s', 'mod fold rail'],
  ['ar18', 'ArmaLite AR-18', 'assault', 'US', 1969, '5.56x45', 3.0, 970, 464, 750, 990, 30, 'a s', 'mod fold'],
  ['acr', 'Bushmaster ACR', 'assault', 'US', 2010, '5.56x45', 3.6, 917, 419, 700, 900, 30, 'a s', 'mod fold rail tan holo'],
  ['bren2', 'CZ BREN 2', 'assault', 'CZ', 2016, '5.56x45', 3.1, 851, 357, 850, 870, 30, 'a s', 'mod fold rail dot'],
  ['hk33', 'HK33A2', 'assault', 'DE', 1968, '5.56x45', 3.65, 920, 390, 750, 920, 25, 'a s', 'g3 curve'],
  ['aug', 'Steyr AUG A1', 'assault', 'AT', 1978, '5.56x45', 3.6, 790, 508, 700, 970, 30, 'a s', 'bullpup aug15 fgrip green clearmag'],
  ['ef88', 'Lithgow EF88 Austeyr', 'assault', 'AU', 2015, '5.56x45', 3.39, 802, 508, 700, 930, 30, 'a s', 'bullpup rail acog fgrip'],
  ['famas', 'FAMAS F1', 'assault', 'FR', 1978, '5.56x45', 3.61, 757, 488, 950, 960, 25, 'a b3 s', 'bullpup handle bipod'],
  ['l85', 'L85A2 (SA80)', 'assault', 'GB', 1985, '5.56x45', 3.82, 785, 518, 700, 940, 30, 'a s', 'bullpup susat green'],
  ['tar21', 'IWI Tavor TAR-21', 'assault', 'IL', 2001, '5.56x45', 3.27, 720, 460, 850, 910, 30, 'a s', 'bullpup dot'],
  ['f2000', 'FN F2000', 'assault', 'BE', 2001, '5.56x45', 3.6, 688, 400, 850, 900, 30, 'a s', 'bullpup aug15'],
  ['qbz95', 'QBZ-95', 'assault', 'CN', 1997, '5.8x42', 3.25, 745, 463, 650, 930, 30, 'a s', 'bullpup handle'],
  ['sar21', 'SAR 21', 'assault', 'SG', 1999, '5.56x45', 3.82, 805, 508, 550, 970, 30, 'a s', 'bullpup aug15'],
  ['g11', 'HK G11', 'assault', 'DE', 1990, '4.73x33', 3.65, 750, 540, 460, 930, 45, 'a b3 s', 'bullpup aug15 g11', { burstRpm: 2100 }],
  ['groza', 'OTs-14 Groza', 'assault', 'RU', 1994, '9x39', 2.7, 610, 240, 700, 300, 20, 'a s', 'bullpup handle sup'],
  ['stg44', 'Sturmgewehr 44', 'assault', 'DE', 1944, '7.92x33', 4.62, 940, 419, 550, 685, 30, 'a s', 'ak wood curve longmag'],
  ['asval', 'AS Val', 'assault', 'SU', 1987, '9x39', 2.5, 875, 200, 900, 295, 20, 'a s', 'ak fold skel sup'],
  ['m1carbine', 'M1 Carbine', 'assault', 'US', 1942, '.30carbine', 2.36, 904, 457, 0, 607, 15, 's', 'woodrifle box'],
  ['ak15', 'AK-15', 'assault', 'RU', 2018, '7.62x39', 3.5, 940, 415, 700, 715, 30, 'a b2 s', 'ak rail tele brake curve'],
  ['ak105', 'AK-105', 'assault', 'RU', 2001, '5.45x39', 3.2, 824, 314, 600, 840, 30, 'a s', 'ak fold'],
  ['ak104', 'AK-104', 'assault', 'RU', 2001, '7.62x39', 3.2, 824, 314, 600, 670, 30, 'a s', 'ak fold curve'],
  ['ak101', 'AK-101', 'assault', 'RU', 1995, '5.56x45', 3.6, 943, 415, 600, 910, 30, 'a s', 'ak fold'],
  ['akms', 'AKMS', 'assault', 'SU', 1959, '7.62x39', 3.3, 880, 415, 600, 715, 30, 'a s', 'ak fold curve'],
  ['galilace', 'IWI Galil ACE 21', 'assault', 'IL', 2008, '5.56x45', 3.44, 847, 406, 700, 915, 35, 'a s', 'ak rail tele'],
  ['ak9', 'AK-9', 'assault', 'RU', 2004, '9x39', 3.1, 705, 200, 700, 290, 20, 'a s', 'ak fold sup'],
  ['mcx', 'SIG MCX', 'assault', 'US', 2015, '5.56x45', 2.6, 780, 292, 800, 850, 30, 'a s', 'ar rail tele fgrip'],
  ['t91', 'T91', 'assault', 'TW', 2003, '5.56x45', 3.17, 880, 406, 800, 840, 30, 'a b3 s', 'ar tele rail'],
  ['k1a', 'Daewoo K1A', 'assault', 'KR', 1981, '5.56x45', 2.87, 838, 263, 800, 820, 30, 'a b3 s', 'ar tele hider'],
  ['lr300', 'Z-M LR-300', 'assault', 'US', 2000, '5.56x45', 3.2, 925, 419, 950, 900, 30, 'a s', 'ar tele rail'],
  ['m27', 'M27 IAR', 'assault', 'US', 2010, '5.56x45', 3.6, 940, 420, 850, 890, 30, 'a s', 'ar tele rail fgrip acog'],
  ['c8', 'Colt Canada C8 (L119A1)', 'assault', 'CA', 1994, '5.56x45', 2.7, 840, 400, 900, 895, 30, 'a s', 'ar tele rail fgrip'],
  ['xm8', 'HK XM8', 'assault', 'DE', 2003, '5.56x45', 3.4, 838, 318, 750, 900, 30, 'a s', 'mod handle clearmag'],
  ['cz805', 'CZ 805 BREN', 'assault', 'CZ', 2011, '5.56x45', 3.6, 915, 360, 750, 880, 30, 'a b2 s', 'mod rail fold clearmag'],
  ['msbs', 'MSBS Grot', 'assault', 'PL', 2017, '5.56x45', 3.65, 900, 406, 800, 890, 30, 'a s', 'mod rail fold'],
  ['ia2', 'IMBEL IA2', 'assault', 'BR', 2012, '5.56x45', 3.38, 850, 350, 750, 850, 30, 'a s', 'mod rail fold'],
  ['ak5', 'Bofors Ak 5', 'assault', 'SE', 1986, '5.56x45', 3.9, 1008, 450, 650, 930, 30, 'a s', 'mod fold green'],
  ['ar70', 'Beretta AR70/90', 'assault', 'IT', 1990, '5.56x45', 3.99, 998, 450, 670, 950, 30, 'a b3 s', 'mod handle'],
  ['hk433', 'HK433', 'assault', 'DE', 2017, '5.56x45', 3.5, 843, 421, 700, 880, 30, 'a s', 'mod rail fold'],
  ['qbz03', 'QBZ-03', 'assault', 'CN', 2003, '5.8x42', 3.5, 950, 440, 650, 930, 30, 'a s', 'mod fold'],
  ['sr3m', 'SR-3M Vikhr', 'assault', 'RU', 1996, '9x39', 2.2, 610, 156, 900, 295, 30, 'a s', 'mod fold'],
  ['vhs2', 'HS Produkt VHS-2', 'assault', 'HR', 2013, '5.56x45', 3.4, 765, 500, 860, 950, 30, 'a s', 'bullpup handle rail'],
  ['x95', 'IWI Tavor X95', 'assault', 'IL', 2009, '5.56x45', 3.3, 580, 330, 850, 855, 30, 'a s', 'bullpup rail dot'],
  ['cetmel', 'CETME Model L', 'assault', 'ES', 1984, '5.56x45', 3.4, 925, 400, 650, 875, 30, 'a s', 'g3 curve'],
  ['mini14', 'Ruger Mini-14', 'assault', 'US', 1973, '5.56x45', 2.9, 946, 470, 0, 960, 20, 's', 'woodrifle box'],
  // ------------------------------------------------------------------ BATTLE & MARKSMAN RIFLES
  ['fal', 'FN FAL', 'battle', 'BE', 1953, '7.62x51', 4.25, 1090, 533, 650, 840, 20, 'a s', 'fal wood'],
  ['l1a1', 'L1A1 SLR (Lithgow)', 'battle', 'AU', 1957, '7.62x51', 4.34, 1143, 554, 0, 823, 20, 's', 'fal wood'],
  ['g3', 'HK G3A3', 'battle', 'DE', 1959, '7.62x51', 4.38, 1025, 450, 550, 800, 20, 'a s', 'g3 green'],
  ['m14', 'M14', 'battle', 'US', 1959, '7.62x51', 4.1, 1126, 559, 725, 850, 20, 'a s', 'woodrifle box'],
  ['mk14', 'Mk 14 EBR', 'battle', 'US', 2002, '7.62x51', 5.1, 889, 457, 725, 853, 20, 'a s', 'mod tele rail scope4 bipod'],
  ['m21', 'M21 SWS', 'battle', 'US', 1969, '7.62x51', 5.27, 1118, 560, 0, 853, 20, 's', 'woodrifle box scope8'],
  ['scarh', 'FN SCAR-H (Mk 17)', 'battle', 'BE', 2009, '7.62x51', 3.58, 965, 400, 600, 714, 20, 'a s', 'mod fold rail tan acog'],
  ['hk417', 'HK417', 'battle', 'DE', 2006, '7.62x51', 4.4, 985, 419, 600, 750, 20, 'a s', 'ar tele rail acog'],
  ['sr25', 'KAC SR-25 (M110)', 'battle', 'US', 1990, '7.62x51', 4.88, 1118, 508, 0, 783, 20, 's', 'ar rail scope8 bipod sup'],
  ['mk12', 'Mk 12 SPR', 'battle', 'US', 2002, '5.56x45', 4.5, 953, 457, 0, 810, 30, 's', 'ar rail scope6 bipod sup'],
  ['l129', 'L129A1 Sharpshooter', 'battle', 'GB', 2010, '7.62x51', 4.5, 990, 406, 0, 780, 20, 's', 'ar tele rail scope6 tan'],
  ['xm7', 'SIG MCX Spear (XM7)', 'battle', 'US', 2022, '6.8x51', 3.8, 914, 330, 800, 915, 20, 'a s', 'ar fold rail tan scope4 sup'],
  ['garand', 'M1 Garand', 'battle', 'US', 1936, '.30-06', 4.31, 1107, 610, 0, 853, 8, 's', 'woodrifle enbloc'],
  ['svt40', 'Tokarev SVT-40', 'battle', 'SU', 1940, '7.62x54r', 3.85, 1226, 625, 0, 830, 10, 's', 'woodrifle box brake'],
  ['g43', 'Gewehr 43', 'battle', 'DE', 1943, '7.92x57', 4.4, 1130, 550, 0, 746, 10, 's', 'woodrifle box'],
  ['sks', 'SKS', 'battle', 'SU', 1945, '7.62x39', 3.85, 1021, 520, 0, 735, 10, 's', 'woodrifle internal bayonet'],
  ['svd', 'Dragunov SVD', 'battle', 'SU', 1963, '7.62x54r', 4.3, 1225, 620, 0, 830, 10, 's', 'ak wood skel pso'],
  ['vss', 'VSS Vintorez', 'battle', 'SU', 1987, '9x39', 2.6, 894, 200, 700, 290, 10, 'a s', 'ak wood skel pso sup'],
  ['zm76', 'Zastava M76', 'battle', 'YU', 1976, '7.92x57', 4.6, 1135, 550, 0, 720, 10, 's', 'ak wood pso'],
  ['fg42', 'FG 42', 'battle', 'DE', 1942, '7.92x57', 4.2, 945, 500, 750, 740, 20, 'a s', 'mod wood side bipod bayonet'],
  ['mas49', 'MAS-49/56', 'battle', 'FR', 1957, '7.5x54', 4.1, 1020, 525, 0, 820, 10, 's', 'woodrifle box'],
  ['sig510', 'SIG SG 510 (Stgw 57)', 'battle', 'CH', 1957, '7.5x55', 5.7, 1105, 583, 500, 750, 24, 'a s', 'g3 bipod wood'],
  ['ar10', 'ArmaLite AR-10', 'battle', 'US', 1956, '7.62x51', 3.3, 1050, 528, 700, 820, 20, 'a s', 'ar handle wood'],
  ['type64', 'Howa Type 64', 'battle', 'JP', 1964, '7.62x51', 4.4, 990, 450, 500, 700, 20, 'a s', 'mod wood bipod'],
  ['bm59', 'Beretta BM 59', 'battle', 'IT', 1959, '7.62x51', 4.4, 1095, 491, 750, 823, 20, 'a s', 'woodrifle box bipod'],
  ['qbu88', 'QBU-88', 'battle', 'CN', 1997, '5.8x42', 4.1, 920, 640, 0, 895, 10, 's', 'bullpup scope4 bipod'],
  ['m110', 'M110 SASS', 'battle', 'US', 2008, '7.62x51', 6.94, 1029, 508, 0, 783, 20, 's', 'ar rail scope8 bipod sup tan'],
  ['g28', 'HK G28', 'battle', 'DE', 2011, '7.62x51', 5.8, 1082, 421, 0, 785, 20, 's', 'ar rail scope8 bipod tan'],
  ['sig716', 'SIG 716i', 'battle', 'US', 2019, '7.62x51', 4.2, 950, 406, 650, 790, 20, 'a s', 'ar tele rail'],
  ['scar20', 'FN Mk 20 SSR', 'battle', 'BE', 2010, '7.62x51', 5.1, 1080, 508, 0, 810, 20, 's', 'mod rail scope4 bipod tan'],
  ['bren2br', 'CZ BREN 2 BR', 'battle', 'CZ', 2018, '7.62x51', 3.8, 946, 407, 600, 780, 25, 'a s', 'mod rail fold'],
  ['svch', 'Chukavin SVCh', 'battle', 'RU', 2017, '7.62x54r', 4.2, 995, 410, 0, 800, 10, 's', 'mod rail scope4 fold'],
  ['svds', 'Dragunov SVDS', 'battle', 'RU', 1995, '7.62x54r', 4.68, 1135, 565, 0, 810, 10, 's', 'ak skel pso'],
  ['ak308', 'AK-308', 'battle', 'RU', 2018, '7.62x51', 4.3, 945, 415, 700, 800, 20, 'a s', 'ak wood'],
  ['m77', 'Zastava M77', 'battle', 'YU', 1977, '7.62x51', 4.8, 990, 500, 600, 840, 20, 'a s', 'ak wood'],
  ['galatz', 'IMI Galatz', 'battle', 'IL', 1983, '7.62x51', 6.4, 1112, 508, 0, 815, 25, 's', 'ak wood skel pso'],
  ['cetme', 'CETME Model C', 'battle', 'ES', 1964, '7.62x51', 4.5, 1015, 450, 600, 780, 20, 'a s', 'g3 wood'],
  ['fn49', 'FN Model 1949', 'battle', 'BE', 1949, '.30-06', 4.31, 1116, 590, 0, 853, 10, 's', 'woodrifle internal'],
  ['hakim', 'Hakim rifle', 'battle', 'EG', 1950, '7.92x57', 4.7, 1215, 638, 0, 870, 10, 's', 'woodrifle box'],
  ['rasheed', 'Rasheed carbine', 'battle', 'EG', 1960, '7.62x39', 4.2, 1035, 520, 0, 730, 10, 's', 'woodrifle box bayonet'],
  ['m1941', 'M1941 Johnson rifle', 'battle', 'US', 1941, '.30-06', 4.31, 1156, 560, 0, 808, 10, 's', 'woodrifle internal'],
  // ------------------------------------------------------------------ SNIPER & ANTI-MATERIEL
  ['m24', 'M24 SWS (Remington 700)', 'sniper', 'US', 1988, '7.62x51', 5.5, 1092, 610, 0, 790, 5, 'bolt', 'chassis scope10 bipod internal'],
  ['m40a5', 'M40A5', 'sniper', 'US', 2009, '7.62x51', 7.5, 1124, 635, 0, 777, 10, 'bolt', 'chassis scope10 bipod green sup'],
  ['awm', 'AI AWM (L115A3)', 'sniper', 'GB', 1996, '.338lm', 6.9, 1300, 686, 0, 936, 5, 'bolt', 'chassis thumb scope12 bipod green brake'],
  ['l96', 'AI Arctic Warfare (L96A1)', 'sniper', 'GB', 1982, '7.62x51', 6.5, 1180, 660, 0, 850, 10, 'bolt', 'chassis thumb scope10 bipod green'],
  ['trg42', 'Sako TRG-42', 'sniper', 'FI', 1999, '.338lm', 5.3, 1200, 690, 0, 915, 5, 'bolt', 'chassis scope12 bipod brake green'],
  ['sv98', 'SV-98', 'sniper', 'RU', 1998, '7.62x54r', 5.8, 1200, 650, 0, 820, 10, 'bolt', 'chassis thumb scope8 bipod'],
  ['ssg69', 'Steyr SSG 69', 'sniper', 'AT', 1969, '7.62x51', 3.9, 1140, 650, 0, 860, 5, 'bolt', 'chassis scope6 green'],
  ['scout', 'Steyr Scout', 'sniper', 'AT', 1998, '7.62x51', 3.0, 1039, 483, 0, 840, 5, 'bolt', 'chassis scout bipod grey'],
  ['frf2', 'FR F2', 'sniper', 'FR', 1986, '7.62x51', 5.3, 1200, 650, 0, 820, 10, 'bolt', 'chassis wood scope8 bipod shroud'],
  ['dsr1', 'DSR-Precision DSR-1', 'sniper', 'DE', 2000, '.338lm', 5.9, 990, 650, 0, 880, 4, 'bolt', 'chassis bullpup scope12 bipod brake'],
  ['wa2000', 'Walther WA 2000', 'sniper', 'DE', 1982, '.300wm', 6.95, 905, 650, 0, 980, 6, 's', 'chassis bullpup wood scope10 bipod'],
  ['m2010', 'M2010 ESR', 'sniper', 'US', 2010, '.300wm', 5.5, 1181, 610, 0, 869, 5, 'bolt', 'chassis skel rail scope12 bipod sup tan'],
  ['mrad', 'Barrett MRAD (Mk 22)', 'sniper', 'US', 2013, '.338nm', 6.3, 1258, 686, 0, 808, 10, 'bolt', 'chassis fold rail scope12 bipod brake tan'],
  ['m200', 'CheyTac M200 Intervention', 'sniper', 'US', 2001, '.408', 14.1, 1346, 737, 0, 900, 7, 'bolt', 'chassis skel scope12 bipod bigbrake'],
  ['m82', 'Barrett M82A1', 'sniper', 'US', 1982, '.50bmg', 14.0, 1448, 737, 0, 853, 10, 's', 'amr scope10 bipod bigbrake'],
  ['m95', 'Barrett M95', 'sniper', 'US', 1995, '.50bmg', 10.7, 1143, 737, 0, 854, 5, 'bolt', 'amr bullpup scope10 bipod bigbrake'],
  ['tac50', 'McMillan TAC-50', 'sniper', 'US', 2000, '.50bmg', 11.8, 1448, 737, 0, 823, 5, 'bolt', 'chassis scope12 bipod bigbrake tan'],
  ['hecate', 'PGM Hécate II', 'sniper', 'FR', 1993, '.50bmg', 13.8, 1380, 700, 0, 825, 7, 'bolt', 'chassis skel scope10 bipod bigbrake'],
  ['osv96', 'OSV-96', 'sniper', 'RU', 1994, '12.7x108', 12.9, 1746, 1000, 0, 900, 5, 's', 'amr scope10 bipod bigbrake'],
  ['ntw20', 'Denel NTW-20', 'sniper', 'ZA', 1998, '20x82', 31, 1795, 1000, 0, 720, 3, 'bolt', 'amr scope8 bipod bigbrake'],
  ['ptrs', 'PTRS-41', 'sniper', 'SU', 1941, '14.5x114', 20.3, 2100, 1219, 0, 1012, 5, 's', 'amr bipod bigbrake wood'],
  ['boys', 'Boys Anti-Tank Rifle', 'sniper', 'GB', 1937, '.55boys', 16, 1575, 910, 0, 747, 5, 'bolt', 'amr bipod bigbrake top'],
  ['win70', 'Winchester Model 70', 'sniper', 'US', 1936, '.30-06', 3.6, 1124, 610, 0, 887, 5, 'bolt', 'woodrifle bolt scope8 internal'],
  ['mosinpu', 'Mosin-Nagant 91/30 PU', 'sniper', 'SU', 1942, '7.62x54r', 4.3, 1232, 730, 0, 865, 5, 'bolt', 'woodrifle bolt pu internal'],
  ['k98zf', 'Karabiner 98k ZF39', 'sniper', 'DE', 1939, '7.92x57', 4.4, 1110, 600, 0, 760, 5, 'bolt', 'woodrifle bolt zf internal'],
  ['m1903a4', 'Springfield M1903A4', 'sniper', 'US', 1943, '.30-06', 4.3, 1097, 610, 0, 853, 5, 'bolt', 'woodrifle bolt zf internal'],
  ['no4t', 'Lee-Enfield No. 4 Mk I (T)', 'sniper', 'GB', 1942, '.303', 4.7, 1129, 640, 0, 744, 10, 'bolt', 'woodrifle bolt pu box', { cycle: 0.85 }],
  ['psg1', 'HK PSG1', 'sniper', 'DE', 1972, '7.62x51', 7.2, 1230, 650, 0, 868, 20, 's', 'chassis scope6 bipod thumb'],
  ['ssg3000', 'SIG SSG 3000', 'sniper', 'CH', 1992, '7.62x51', 5.44, 1180, 600, 0, 830, 5, 'bolt', 'chassis scope10 bipod'],
  ['sp66', 'Mauser SP66', 'sniper', 'DE', 1976, '7.62x51', 6.25, 1210, 650, 0, 868, 3, 'bolt', 'chassis thumb scope10 wood internal'],
  ['mk13', 'Mk 13 Mod 7', 'sniper', 'US', 2018, '.300wm', 5.2, 1200, 673, 0, 900, 5, 'bolt', 'chassis scope10 bipod sup tan'],
  ['t5000', 'Orsis T-5000', 'sniper', 'RU', 2011, '.338lm', 6.3, 1270, 698, 0, 900, 5, 'bolt', 'chassis scope10 bipod fold brake'],
  ['axmc', 'Accuracy International AXMC', 'sniper', 'GB', 2014, '.338lm', 6.8, 1250, 686, 0, 936, 10, 'bolt', 'chassis scope12 bipod fold tan brake'],
  ['timberwolf', 'C14 Timberwolf', 'sniper', 'CA', 2005, '.338lm', 7.1, 1270, 660, 0, 880, 5, 'bolt', 'chassis scope10 bipod green brake'],
  ['pgm338', 'PGM 338', 'sniper', 'FR', 2002, '.338lm', 6.6, 1294, 690, 0, 915, 10, 'bolt', 'chassis scope10 bipod skel brake'],
  ['ballista', 'FN Ballista', 'sniper', 'BE', 2012, '.338lm', 6.8, 1280, 660, 0, 900, 8, 'bolt', 'chassis scope12 bipod fold tan'],
  ['srs', 'Desert Tech SRS-A1', 'sniper', 'US', 2008, '.338lm', 5.6, 950, 660, 0, 880, 5, 'bolt', 'chassis bullpup scope10 bipod'],
  ['aw50', 'Accuracy International AW50', 'sniper', 'GB', 1998, '.50bmg', 15.0, 1420, 686, 0, 850, 5, 'bolt', 'amr scope10 bipod bigbrake'],
  ['m99', 'Barrett M99', 'sniper', 'US', 1999, '.50bmg', 11.8, 1280, 813, 0, 900, 1, 'bolt', 'amr bullpup scope10 bipod bigbrake'],
  ['hs50', 'Steyr HS .50', 'sniper', 'AT', 2004, '.50bmg', 12.4, 1370, 833, 0, 760, 1, 'bolt', 'amr scope10 bipod bigbrake'],
  ['ksvk', 'KSVK 12.7', 'sniper', 'RU', 1997, '12.7x108', 12.0, 1400, 1000, 0, 800, 5, 'bolt', 'amr bullpup scope8 bipod bigbrake'],
  ['gepard', 'Gepárd M1', 'sniper', 'HU', 1990, '12.7x108', 19.0, 1570, 1100, 0, 860, 1, 'bolt', 'amr scope10 bipod bigbrake'],
  ['qbu10', 'QBU-10', 'sniper', 'CN', 2010, '12.7x108', 13.3, 1380, 780, 0, 800, 5, 's', 'amr scope8 bipod bigbrake'],
  // ------------------------------------------------------------------ CLASSIC RIFLES
  ['mosin', 'Mosin-Nagant M91/30', 'classic', 'RU', 1891, '7.62x54r', 4.0, 1232, 730, 0, 865, 5, 'bolt', 'woodrifle bolt internal bayonet'],
  ['kar98k', 'Karabiner 98k', 'classic', 'DE', 1935, '7.92x57', 3.9, 1110, 600, 0, 760, 5, 'bolt', 'woodrifle bolt internal'],
  ['gew98', 'Mauser Gewehr 98', 'classic', 'DE', 1898, '7.92x57', 4.09, 1250, 740, 0, 878, 5, 'bolt', 'woodrifle bolt internal'],
  ['enfield', 'Lee-Enfield No. 4 Mk I', 'classic', 'GB', 1941, '.303', 4.11, 1129, 640, 0, 744, 10, 'bolt', 'woodrifle bolt box', { cycle: 0.8 }],
  ['smle', 'Lee-Enfield SMLE Mk III', 'classic', 'GB', 1907, '.303', 3.96, 1132, 640, 0, 744, 10, 'bolt', 'woodrifle bolt box bayonet', { cycle: 0.8 }],
  ['m1903', 'Springfield M1903', 'classic', 'US', 1903, '.30-06', 3.9, 1097, 610, 0, 853, 5, 'bolt', 'woodrifle bolt internal'],
  ['arisaka', 'Arisaka Type 99', 'classic', 'JP', 1939, '7.7x58', 3.7, 1120, 657, 0, 730, 5, 'bolt', 'woodrifle bolt internal'],
  ['mas36', 'MAS-36', 'classic', 'FR', 1936, '7.5x54', 3.72, 1020, 575, 0, 850, 5, 'bolt', 'woodrifle bolt internal'],
  ['carcano', 'Carcano M91/38', 'classic', 'IT', 1938, '6.5x52', 3.4, 1015, 538, 0, 700, 6, 'bolt', 'woodrifle bolt enbloc'],
  ['mannlicher', 'Mannlicher M1895', 'classic', 'AT', 1895, '8x50r', 3.78, 1272, 765, 0, 620, 5, 'bolt', 'woodrifle bolt enbloc', { cycle: 0.75 }],
  ['lebel', 'Lebel Model 1886', 'classic', 'FR', 1886, '8x50r', 4.18, 1300, 800, 0, 700, 8, 'bolt', 'woodrifle bolt tube'],
  ['win1894', 'Winchester Model 1894', 'classic', 'US', 1894, '.30-30', 3.1, 960, 508, 0, 680, 7, 'lever', 'lever'],
  ['win1873', 'Winchester Model 1873', 'classic', 'US', 1873, '.44-40', 4.3, 1252, 610, 0, 380, 15, 'lever', 'lever'],
  ['marlin1895', 'Marlin Model 1895', 'classic', 'US', 1895, '.45-70', 3.4, 1035, 559, 0, 400, 4, 'lever', 'lever'],
  ['sharps', 'Sharps Model 1874', 'classic', 'US', 1874, '.45-70', 4.5, 1194, 762, 0, 410, 1, 'single', 'woodrifle single'],
  ['martini', 'Martini-Henry Mk IV', 'classic', 'GB', 1871, '.577/450', 3.83, 1245, 844, 0, 400, 1, 'single', 'woodrifle single'],
  ['brownbess', 'Brown Bess musket', 'classic', 'GB', 1722, '.75ball', 4.8, 1490, 1070, 0, 300, 1, 'single', 'musket bayonet'],
  ['m1861', 'Springfield Model 1861', 'classic', 'US', 1861, '.58minie', 4.1, 1420, 1016, 0, 290, 1, 'single', 'musket rifled'],
  ['kentucky', 'Kentucky long rifle', 'classic', 'US', 1730, '.50ball', 4.0, 1500, 1100, 0, 380, 1, 'single', 'musket rifled'],
  ['ruger1022', 'Ruger 10/22', 'classic', 'US', 1964, '.22lr', 2.3, 940, 470, 0, 370, 10, 's', 'woodrifle box'],
  ['p17', 'M1917 Enfield', 'classic', 'US', 1917, '.30-06', 4.17, 1175, 660, 0, 823, 6, 'bolt', 'woodrifle bolt internal bayonet'],
  ['k31', 'Schmidt-Rubin K31', 'classic', 'CH', 1931, '7.5x55', 4.0, 1105, 652, 0, 780, 6, 'bolt', 'woodrifle bolt box'],
  ['berthier', 'Berthier Mle 1907/15', 'classic', 'FR', 1915, '8x50r', 3.8, 1306, 803, 0, 701, 3, 'bolt', 'woodrifle bolt internal bayonet'],
  ['no5', 'Lee-Enfield No. 5 Jungle Carbine', 'classic', 'GB', 1944, '.303', 3.24, 1003, 476, 0, 720, 10, 'bolt', 'woodrifle bolt box'],
  ['m44', 'Mosin-Nagant M44', 'classic', 'SU', 1944, '7.62x54r', 4.1, 1020, 520, 0, 820, 5, 'bolt', 'woodrifle bolt internal bayonet'],
  ['vz24', 'vz. 24', 'classic', 'CS', 1924, '7.92x57', 4.2, 1100, 590, 0, 760, 5, 'bolt', 'woodrifle bolt internal'],
  ['trapdoor', 'Springfield Model 1873 "Trapdoor"', 'classic', 'US', 1873, '.45-70', 4.2, 1321, 829, 0, 410, 1, 'single', 'woodrifle single bayonet'],
  ['rollingblock', 'Remington Rolling Block', 'classic', 'US', 1867, '.45-70', 4.1, 1280, 900, 0, 400, 1, 'single', 'woodrifle single'],
  ['win1892', 'Winchester Model 1892', 'classic', 'US', 1892, '.44-40', 3.0, 1080, 610, 0, 380, 13, 'lever', 'lever'],
  ['win1895', 'Winchester Model 1895', 'classic', 'US', 1895, '.30-06', 4.2, 1175, 710, 0, 820, 5, 'lever', 'lever'],
  ['marlin336', 'Marlin Model 336', 'classic', 'US', 1948, '.30-30', 3.2, 978, 508, 0, 670, 6, 'lever', 'lever'],
  ['p1853', 'Pattern 1853 Enfield', 'classic', 'GB', 1853, '.58minie', 4.3, 1400, 990, 0, 290, 1, 'single', 'musket rifled bayonet'],
  // ------------------------------------------------------------------ SHOTGUNS
  ['r870', 'Remington 870', 'shotgun', 'US', 1950, '12ga', 3.6, 978, 457, 0, 400, 7, 'pump', 'pump wood tube'],
  ['m590', 'Mossberg 590A1', 'shotgun', 'US', 1987, '12ga', 3.3, 1041, 508, 0, 400, 9, 'pump', 'pump tube shield bayonet'],
  ['m1897', 'Winchester M1897 Trench Gun', 'shotgun', 'US', 1897, '12ga', 3.6, 1000, 508, 0, 400, 6, 'pump', 'pump wood tube shield bayonet', { slam: true }],
  ['ithaca37', 'Ithaca 37', 'shotgun', 'US', 1937, '12ga', 3.0, 1006, 508, 0, 400, 5, 'pump', 'pump wood tube', { slam: true }],
  ['m4bene', 'Benelli M4 (M1014)', 'shotgun', 'IT', 1999, '12ga', 3.82, 1010, 470, 0, 400, 8, 's', 'pump tube tele'],
  ['spas12', 'Franchi SPAS-12', 'shotgun', 'IT', 1979, '12ga', 4.4, 1041, 546, 0, 400, 9, 's', 'pump tube fold shield'],
  ['auto5', 'Browning Auto-5', 'shotgun', 'BE', 1902, '12ga', 4.1, 1270, 711, 0, 400, 5, 's', 'pump wood tube'],
  ['b1301', 'Beretta 1301 Tactical', 'shotgun', 'IT', 2014, '12ga', 2.9, 960, 470, 0, 400, 8, 's', 'pump tube'],
  ['saiga12', 'Saiga-12K', 'shotgun', 'RU', 1997, '12ga', 3.5, 910, 430, 0, 400, 8, 's', 'ak fold bigmag'],
  ['aa12', 'AA-12', 'shotgun', 'US', 2005, '12ga', 5.2, 966, 457, 300, 350, 20, 'a', 'mod drum bigmag bal'],
  ['usas12', 'Daewoo USAS-12', 'shotgun', 'KR', 1989, '12ga', 5.5, 960, 460, 360, 400, 20, 'a s', 'ar handle drum bigmag'],
  ['jackhammer', 'Pancor Jackhammer', 'shotgun', 'US', 1987, '12ga', 4.57, 787, 525, 240, 400, 10, 'a', 'bullpup handle drum bigmag'],
  ['striker', 'Armsel Striker', 'shotgun', 'ZA', 1981, '12ga', 4.2, 792, 304, 0, 400, 12, 'da', 'mod fold drum bigmag fgrip', { feed: 'gate' }],
  ['coach', 'Stoeger Coach Gun', 'shotgun', 'BR', 1977, '12ga', 2.95, 914, 508, 0, 400, 2, 'single', 'double wood'],
  ['lupara', 'Lupara (sawn-off)', 'shotgun', 'IT', 1880, '12ga', 2.0, 520, 300, 0, 360, 2, 'single', 'double wood sawn'],
  ['citori', 'Browning Citori', 'shotgun', 'JP', 1973, '12ga', 3.6, 1143, 711, 0, 405, 2, 'single', 'double wood ou'],
  ['ks23', 'KS-23', 'shotgun', 'SU', 1971, '23mm', 3.85, 1040, 510, 0, 210, 4, 'pump', 'pump wood tube fat'],
  ['ksg', 'Kel-Tec KSG', 'shotgun', 'US', 2011, '12ga', 3.1, 663, 470, 0, 400, 15, 'pump', 'pump bullpup rail tube'],
  ['uts15', 'UTAS UTS-15', 'shotgun', 'TR', 2012, '12ga', 3.1, 720, 470, 0, 400, 15, 'pump', 'pump bullpup rail tube'],
  ['shorty', 'Serbu Super-Shorty', 'shotgun', 'US', 1996, '12ga', 1.8, 420, 165, 0, 330, 3, 'pump', 'pump nostock tube sawn'],
  ['m1887', 'Winchester Model 1887', 'shotgun', 'US', 1887, '12ga', 3.6, 997, 508, 0, 380, 6, 'lever', 'lever fat'],
  ['blunderbuss', 'Blunderbuss', 'shotgun', 'GB', 1700, 'blunder', 3.0, 760, 400, 0, 250, 1, 'single', 'musket flare sawn'],
  ['m500', 'Mossberg 500', 'shotgun', 'US', 1961, '12ga', 3.4, 1003, 470, 0, 400, 6, 'pump', 'pump tube'],
  ['nova', 'Benelli Nova Tactical', 'shotgun', 'IT', 1999, '12ga', 3.63, 1010, 470, 0, 400, 5, 'pump', 'pump tube'],
  ['win12', 'Winchester Model 12', 'shotgun', 'US', 1912, '12ga', 3.4, 1003, 508, 0, 400, 6, 'pump', 'pump wood tube', { slam: true }],
  ['toz194', 'TOZ-194', 'shotgun', 'RU', 1994, '12ga', 2.9, 805, 540, 0, 400, 7, 'pump', 'pump nostock tube'],
  ['neostead', 'NeoStead 2000', 'shotgun', 'ZA', 2001, '12ga', 3.9, 690, 570, 0, 400, 12, 'pump', 'pump bullpup tube'],
  ['ks7', 'Kel-Tec KS7', 'shotgun', 'US', 2019, '12ga', 2.7, 663, 470, 0, 400, 7, 'pump', 'pump bullpup tube'],
  ['m3bene', 'Benelli M3 Super 90', 'shotgun', 'IT', 1989, '12ga', 3.45, 1041, 500, 0, 400, 7, 's', 'pump tube fold'],
  ['m1super90', 'Benelli M1 Super 90', 'shotgun', 'IT', 1986, '12ga', 3.2, 1009, 470, 0, 400, 7, 's', 'pump tube'],
  ['r1100', 'Remington 1100', 'shotgun', 'US', 1963, '12ga', 3.6, 1180, 660, 0, 400, 5, 's', 'pump wood tube'],
  ['fnslp', 'FN SLP', 'shotgun', 'BE', 2008, '12ga', 3.7, 1100, 560, 0, 400, 8, 's', 'pump tube rail'],
  ['spas15', 'Franchi SPAS-15', 'shotgun', 'IT', 1986, '12ga', 3.9, 1000, 450, 0, 400, 6, 's', 'mod bigmag fold'],
  ['origin12', 'Fostech Origin 12', 'shotgun', 'US', 2014, '12ga', 4.2, 965, 470, 0, 400, 8, 's', 'mod bigmag fgrip'],
  ['vepr12', 'Vepr-12 Molot', 'shotgun', 'RU', 2003, '12ga', 4.2, 987, 430, 0, 400, 8, 's', 'ak bigmag fold'],
  // ------------------------------------------------------------------ MACHINE GUNS
  ['m249', 'M249 SAW (FN Minimi)', 'mg', 'BE', 1984, '5.56x45', 7.5, 1041, 465, 850, 915, 200, 'a', 'lmg belt bipod'],
  ['mk48', 'Mk 48 Mod 1', 'mg', 'US', 2003, '7.62x51', 8.2, 1000, 502, 730, 792, 100, 'a', 'lmg belt bipod rail'],
  ['m60', 'M60', 'mg', 'US', 1957, '7.62x51', 10.5, 1105, 560, 600, 853, 100, 'a', 'lmg belt bipod'],
  ['m240', 'M240B (FN MAG)', 'mg', 'BE', 1958, '7.62x51', 12.5, 1263, 630, 750, 853, 100, 'a', 'lmg belt bipod'],
  ['pkm', 'PKM', 'mg', 'SU', 1969, '7.62x54r', 7.5, 1192, 605, 650, 825, 100, 'a', 'lmg belt bipod wood skel'],
  ['pkp', 'PKP Pecheneg', 'mg', 'RU', 2001, '7.62x54r', 8.2, 1155, 658, 650, 825, 100, 'a', 'lmg belt bipod skel shroud'],
  ['rpk', 'RPK', 'mg', 'SU', 1961, '7.62x39', 4.8, 1040, 590, 600, 745, 75, 'a s', 'ak wood drum bipod'],
  ['rpk74', 'RPK-74', 'mg', 'SU', 1974, '5.45x39', 4.7, 1070, 590, 600, 960, 45, 'a s', 'ak wood curve bipod longmag'],
  ['rpd', 'RPD', 'mg', 'SU', 1953, '7.62x39', 7.4, 1037, 520, 650, 735, 100, 'a', 'lmg belt bipod wood drumbelt'],
  ['dp27', 'Degtyaryov DP-27', 'mg', 'SU', 1928, '7.62x54r', 9.12, 1270, 604, 550, 840, 47, 'a', 'lmg pan bipod wood'],
  ['mg34', 'MG 34', 'mg', 'DE', 1936, '7.92x57', 12.1, 1219, 627, 850, 765, 50, 'a s', 'lmg belt bipod wood shroud drumbelt'],
  ['mg42', 'MG 42', 'mg', 'DE', 1942, '7.92x57', 11.6, 1220, 533, 1200, 740, 50, 'a', 'lmg belt bipod wood shroud drumbelt'],
  ['mg3', 'Rheinmetall MG 3', 'mg', 'DE', 1960, '7.62x51', 11.5, 1225, 565, 1150, 820, 100, 'a', 'lmg belt bipod shroud'],
  ['bren', 'Bren Mk II', 'mg', 'GB', 1938, '.303', 10.35, 1156, 635, 520, 744, 30, 'a s', 'lmg top bipod wood'],
  ['bar', 'Browning M1918A2 BAR', 'mg', 'US', 1918, '.30-06', 8.8, 1215, 610, 550, 860, 20, 'a', 'lmg box bipod wood'],
  ['lewis', 'Lewis Gun', 'mg', 'GB', 1914, '.303', 12.7, 1280, 670, 550, 744, 47, 'a', 'lmg pan bipod wood fatshroud'],
  ['m1919', 'Browning M1919A6', 'mg', 'US', 1943, '.30-06', 14.7, 1346, 610, 500, 853, 250, 'a', 'lmg belt bipod shroud wood'],
  ['mg0815', 'Maxim MG 08/15', 'mg', 'DE', 1915, '7.92x57', 18, 1445, 719, 480, 890, 100, 'a', 'lmg belt bipod wood fatshroud drumbelt'],
  ['chauchat', 'Chauchat Mle 1915', 'mg', 'FR', 1915, '8x50r', 9.07, 1143, 470, 240, 630, 20, 'a s', 'lmg box bipod wood'],
  ['zb26', 'ZB vz. 26', 'mg', 'CS', 1926, '7.92x57', 9.65, 1161, 602, 500, 744, 20, 'a s', 'lmg top bipod wood'],
  ['type96', 'Type 96 LMG', 'mg', 'JP', 1936, '6.5x50', 9.0, 1070, 550, 500, 735, 30, 'a', 'lmg top bipod wood'],
  ['stoner63', 'Stoner 63A LMG', 'mg', 'US', 1963, '5.56x45', 5.3, 1022, 508, 850, 990, 100, 'a', 'lmg belt bipod'],
  ['ultimax', 'Ultimax 100', 'mg', 'SG', 1982, '5.56x45', 4.9, 1024, 508, 520, 970, 100, 'a', 'lmg drum bipod bal fgrip'],
  ['negev', 'IWI Negev NG-5', 'mg', 'IL', 1997, '5.56x45', 7.6, 1020, 460, 950, 915, 150, 'a s', 'lmg belt bipod fold'],
  ['qbb95', 'QBB-95 LSW', 'mg', 'CN', 1997, '5.8x42', 3.95, 840, 557, 650, 970, 75, 'a s', 'bullpup handle drum bipod'],
  ['l86', 'L86A2 LSW', 'mg', 'GB', 1987, '5.56x45', 6.58, 900, 646, 700, 970, 30, 'a s', 'bullpup susat bipod green'],
  ['m250', 'SIG XM250', 'mg', 'US', 2022, '6.8x51', 5.9, 1000, 444, 800, 880, 100, 'a s', 'lmg belt bipod rail tan sup'],
  ['m2hb', 'Browning M2HB', 'mg', 'US', 1933, '.50bmg', 38, 1654, 1143, 500, 890, 100, 'a', 'hmg belt'],
  ['dshk', 'DShK', 'mg', 'SU', 1938, '12.7x108', 34, 1625, 1070, 600, 850, 50, 'a', 'hmg belt brake'],
  ['m134', 'M134 Minigun', 'mg', 'US', 1963, '7.62x51', 39, 801, 559, 3000, 853, 600, 'a', 'minigun belt', { spin: 0.6 }],
  ['m60e4', 'M60E4 (Mk 43)', 'mg', 'US', 1994, '7.62x51', 10.2, 958, 423, 600, 853, 100, 'a', 'lmg belt bipod fgrip rail'],
  ['hk21', 'HK21', 'mg', 'DE', 1961, '7.62x51', 7.92, 1021, 450, 900, 800, 100, 'a s', 'lmg belt bipod'],
  ['mg5', 'HK MG5', 'mg', 'DE', 2015, '7.62x51', 11.6, 1160, 550, 720, 840, 100, 'a', 'lmg belt bipod rail fgrip'],
  ['mg4', 'HK MG4', 'mg', 'DE', 2005, '5.56x45', 8.15, 1030, 482, 890, 920, 200, 'a', 'lmg belt bipod rail'],
  ['ng7', 'IWI Negev NG7', 'mg', 'IL', 2012, '7.62x51', 7.95, 1100, 508, 700, 860, 100, 'a s', 'lmg belt bipod rail'],
  ['k3', 'Daewoo K3', 'mg', 'KR', 1989, '5.56x45', 6.85, 1030, 533, 850, 915, 200, 'a', 'lmg belt bipod'],
  ['ameli', 'CETME Ameli', 'mg', 'ES', 1982, '5.56x45', 6.35, 970, 400, 1000, 875, 100, 'a', 'lmg belt bipod'],
  ['qjy88', 'QJY-88', 'mg', 'CN', 1988, '5.8x42', 11.8, 1151, 600, 650, 895, 200, 'a', 'lmg belt bipod'],
  ['rpl20', 'RPL-20', 'mg', 'RU', 2020, '5.45x39', 5.2, 1145, 590, 600, 960, 100, 'a', 'lmg belt bipod rail'],
  ['lwmmg', 'SIG MG 338', 'mg', 'US', 2020, '.338nm', 10.9, 1245, 610, 500, 807, 50, 'a s', 'lmg belt bipod rail tan'],
  ['aat52', 'AA-52', 'mg', 'FR', 1952, '7.5x54', 9.97, 1080, 500, 700, 840, 50, 'a', 'lmg belt bipod'],
  ['rp46', 'RP-46', 'mg', 'SU', 1946, '7.62x54r', 13.0, 1272, 605, 600, 825, 250, 'a', 'lmg belt bipod wood'],
  ['breda30', 'Breda Modello 30', 'mg', 'IT', 1930, '6.5x52', 10.6, 1230, 520, 500, 620, 20, 'a', 'lmg bipod wood box'],
  ['madsen', 'Madsen light machine gun', 'mg', 'DK', 1902, '7.92x57', 9.07, 1143, 584, 450, 870, 30, 'a', 'lmg top bipod wood'],
  ['fm2429', 'FM 24/29', 'mg', 'FR', 1929, '7.5x54', 8.9, 1080, 500, 450, 830, 25, 'a s', 'lmg top bipod wood'],
  ['type99', 'Type 99 light machine gun', 'mg', 'JP', 1939, '7.7x58', 10.4, 1181, 550, 700, 730, 30, 'a', 'lmg top bipod wood'],
  ['sg43', 'SG-43 Goryunov', 'mg', 'SU', 1943, '7.62x54r', 13.8, 1150, 720, 600, 800, 250, 'a', 'hmg belt'],
  ['pm1910', 'Maxim PM M1910', 'mg', 'RU', 1910, '7.62x54r', 23.8, 1067, 721, 600, 740, 250, 'a', 'hmg belt'],
  ['vickers', 'Vickers Mk I', 'mg', 'GB', 1912, '.303', 15.0, 1120, 720, 500, 744, 250, 'a', 'hmg belt'],
  ['nsv', 'NSV Utyos', 'mg', 'SU', 1971, '12.7x108', 25.0, 1560, 1100, 750, 845, 50, 'a', 'hmg belt brake'],
  ['kord', 'Kord 6P50', 'mg', 'RU', 1998, '12.7x108', 25.5, 1625, 1070, 700, 820, 50, 'a', 'hmg belt brake'],
  // ------------------------------------------------------------------ LAUNCHERS
  ['rpg7', 'RPG-7', 'launcher', 'SU', 1961, 'pg7', 7.0, 950, 0, 0, 115, 1, 'single', 'rpg wood', { boost: 300 }],
  ['m72', 'M72 LAW', 'launcher', 'US', 1963, '66mm', 2.5, 881, 0, 0, 145, 1, 'single', 'tube green thin', { disposable: true }],
  ['at4', 'AT4 (M136)', 'launcher', 'SE', 1987, '84mm', 6.7, 1016, 0, 0, 285, 1, 'single', 'tube green', { disposable: true }],
  ['carlg', 'Carl Gustaf M4', 'launcher', 'SE', 2014, '84mm', 6.6, 950, 0, 0, 255, 1, 'single', 'tube venturi'],
  ['smaw', 'Mk 153 SMAW', 'launcher', 'US', 1984, '83mm', 7.54, 1371, 0, 0, 220, 1, 'single', 'tube green scope4'],
  ['pzf3', 'Panzerfaust 3', 'launcher', 'DE', 1992, '110mm', 12.9, 1200, 0, 0, 160, 1, 'single', 'pzf', { boost: 243 }],
  ['pzf60', 'Panzerfaust 60', 'launcher', 'DE', 1944, 'pzf', 6.1, 1045, 0, 0, 45, 1, 'single', 'pzf thin tan', { disposable: true }],
  ['pschreck', 'Panzerschreck RPzB 54', 'launcher', 'DE', 1943, '88mm', 11, 1640, 0, 0, 110, 1, 'single', 'tube shield'],
  ['bazooka', 'M1A1 Bazooka', 'launcher', 'US', 1942, '60mm', 5.9, 1370, 0, 0, 81, 1, 'single', 'tube wood thin green'],
  ['piat', 'PIAT', 'launcher', 'GB', 1942, 'piat', 15, 990, 0, 0, 76, 1, 'single', 'piat'],
  ['rpg29', 'RPG-29 Vampir', 'launcher', 'SU', 1989, '105mm', 12.1, 1850, 0, 0, 280, 1, 'single', 'tube venturi'],
  ['javelin', 'FGM-148 Javelin', 'launcher', 'US', 1996, '127mm', 22.3, 1200, 0, 0, 140, 1, 'single', 'tube clu fat', { guided: true, zoom: 4 }],
  ['stinger', 'FIM-92 Stinger', 'launcher', 'US', 1981, '70mm', 15.2, 1520, 0, 0, 200, 1, 'single', 'tube clu green', { guided: true, boost: 420 }],
  ['nlaw', 'NLAW', 'launcher', 'SE', 2009, '150mm', 12.5, 1016, 0, 0, 200, 1, 'single', 'tube fat tan', { disposable: true, guided: true }],
  ['shmel', 'RPO-A Shmel', 'launcher', 'SU', 1988, '93mm', 11, 920, 0, 0, 125, 1, 'single', 'tube fat green', { disposable: true }],
  ['m202', 'M202A1 FLASH', 'launcher', 'US', 1978, '66inc', 5.22, 883, 0, 0, 114, 4, 's', 'm202'],
  ['m79', 'M79 "Thumper"', 'launcher', 'US', 1961, '40mm', 2.7, 731, 356, 0, 76, 1, 'single', 'gl wood'],
  ['m320', 'M320 GLM', 'launcher', 'US', 2009, '40mm', 1.5, 350, 215, 0, 76, 1, 'single', 'gl tele'],
  ['m32', 'Milkor MGL (M32A1)', 'launcher', 'ZA', 1983, '40mm', 5.3, 778, 300, 0, 76, 6, 'da', 'mgl fold dot', { feed: 'gate' }],
  ['rg6', 'RG-6 (6G30)', 'launcher', 'RU', 1994, '40vog', 5.6, 690, 300, 0, 76, 6, 'da', 'mgl tele', { feed: 'gate' }],
  ['chinalake', 'China Lake Launcher', 'launcher', 'US', 1968, '40mm', 3.72, 875, 356, 0, 76, 4, 'pump', 'glpump wood tube'],
  ['gm94', 'GM-94', 'launcher', 'RU', 1993, '43mm', 4.8, 810, 300, 0, 85, 4, 'pump', 'glpump fold tube'],
  ['xm25', 'XM25 CDTE', 'launcher', 'US', 2010, '25mm', 6.35, 749, 300, 0, 210, 5, 's', 'bullpup aug15 fat'],
  // ------------------------------------------------------------------ SPECIAL
  ['m2flame', 'M2A1-7 Flamethrower', 'special', 'US', 1943, 'napalm', 19.5, 1150, 0, 600, 34, 100, 'a', 'flamer'],
  ['flamm41', 'Flammenwerfer 41', 'special', 'DE', 1941, 'napalm', 18, 1100, 0, 600, 32, 80, 'a', 'flamer'],
  ['lpo50', 'LPO-50', 'special', 'SU', 1953, 'napalm', 15, 1100, 0, 600, 42, 60, 'a', 'flamer'],
  ['crossbow', 'Barnett Ghost 410', 'special', 'US', 2012, 'bolt', 3.3, 940, 0, 0, 125, 1, 'single', 'crossbow scope4'],
  ['compound', 'Mathews V3X compound bow', 'special', 'US', 2022, 'arrow', 2.1, 838, 0, 0, 102, 1, 'single', 'bow'],
  ['longbow', 'English longbow', 'special', 'GB', 1300, 'arrow', 0.9, 1900, 0, 0, 58, 1, 'single', 'bow wood'],
  ['taser', 'TASER X26', 'special', 'US', 2003, 'taser', 0.2, 153, 60, 0, 55, 2, 's', 'pistol yellow'],
  ['flaregun', 'Leuchtpistole 34', 'special', 'DE', 1934, 'flare', 0.73, 245, 155, 0, 90, 1, 'single', 'revolver flare'],
];

type MeleeRow = [string, string, string, number, number, number, number, string];
// prettier-ignore
const MELEE: MeleeRow[] = [
  ['kabar', 'KA-BAR USMC', 'US', 1942, 90, 1.9, 0.42, 'knife'],
  ['m9bayonet', 'M9 Bayonet', 'US', 1986, 90, 1.9, 0.42, 'knife'],
  ['fairbairn', 'Fairbairn–Sykes dagger', 'GB', 1941, 100, 1.8, 0.38, 'knife thin'],
  ['nr40', 'NR-40 Combat Knife', 'SU', 1940, 90, 1.9, 0.42, 'knife'],
  ['bowie', 'Bowie Knife', 'US', 1830, 100, 2.0, 0.45, 'knife big'],
  ['karambit', 'Karambit', 'ID', 1100, 85, 1.6, 0.3, 'knife curved'],
  ['kukri', 'Kukri', 'NP', 1810, 130, 2.0, 0.5, 'knife big curved'],
  ['machete', 'Machete', 'LA', 1800, 125, 2.2, 0.55, 'sword short'],
  ['katana', 'Katana', 'JP', 1400, 170, 2.5, 0.6, 'sword curved'],
  ['gladius', 'Gladius', 'RO', -200, 140, 2.1, 0.5, 'sword short wide'],
  ['longsword', 'Longsword', 'DE', 1350, 180, 2.7, 0.75, 'sword long'],
  ['saber', 'M1860 Cavalry Saber', 'US', 1860, 150, 2.5, 0.6, 'sword curved guard'],
  ['tomahawk', 'Tactical Tomahawk', 'US', 1966, 140, 2.0, 0.55, 'axe'],
  ['fireaxe', 'Fire Axe', 'US', 1900, 190, 2.3, 0.85, 'axe long'],
  ['sledge', 'Sledgehammer', 'GB', 1500, 210, 2.4, 1.0, 'axe hammer long'],
  ['mpl50', 'MPL-50 Entrenching Tool', 'RU', 1869, 120, 2.0, 0.55, 'spade'],
  ['bat', 'Baseball Bat', 'US', 1884, 95, 2.3, 0.6, 'club'],
  ['baton', 'ASP Expandable Baton', 'US', 1976, 70, 2.1, 0.4, 'club thin'],
  ['crowbar', 'Crowbar', 'GB', 1400, 105, 2.1, 0.55, 'club thin'],
  ['trenchclub', 'Trench Club', 'GB', 1915, 110, 2.1, 0.6, 'club spiked'],
];

type ThrownRow = [string, string, string, number, WeaponDef['throwKind'], number, number, number, number, string];
// prettier-ignore
const THROWN: ThrownRow[] = [
  ['m67', 'M67 Fragmentation', 'US', 1968, 'frag', 4.0, 7.5, 260, 4, 'frag'],
  ['mk2', 'Mk 2 "Pineapple"', 'US', 1918, 'frag', 4.5, 6.5, 220, 4, 'frag ribbed'],
  ['f1', 'F-1 "Limonka"', 'SU', 1939, 'frag', 3.8, 7.5, 250, 4, 'frag ribbed'],
  ['rgd5', 'RGD-5', 'SU', 1954, 'frag', 3.6, 6.5, 210, 4, 'frag green'],
  ['stiel', 'Stielhandgranate 24', 'DE', 1924, 'frag', 4.5, 5.5, 200, 4, 'stick'],
  ['mills', 'Mills Bomb No. 36M', 'GB', 1915, 'frag', 4.0, 6.5, 220, 4, 'frag ribbed'],
  ['type97', 'Type 97 Grenade', 'JP', 1937, 'frag', 4.5, 5.5, 190, 4, 'frag ribbed'],
  ['v40', 'V40 Mini-Grenade', 'NL', 1968, 'frag', 4.0, 4.5, 150, 7, 'frag small'],
  ['rgo', 'RGO Impact Grenade', 'SU', 1982, 'impact', 0, 6.5, 230, 4, 'frag green'],
  ['m84', 'M84 Stun Grenade', 'US', 1995, 'stun', 1.5, 10, 0, 4, 'can'],
  ['m18', 'M18 Smoke Grenade', 'US', 1942, 'smoke', 1.5, 7, 0, 3, 'can green'],
  ['molotov', 'Molotov Cocktail', 'FI', 1939, 'fire', 0, 4.5, 60, 4, 'molotov'],
  ['anm14', 'AN-M14 Thermite', 'US', 1943, 'fire', 2.0, 3.0, 120, 3, 'can red'],
  ['c4', 'M112 C-4 Charge', 'US', 1956, 'remote', 0, 7.5, 420, 3, 'c4'],
  ['claymore', 'M18A1 Claymore', 'US', 1960, 'mine', 0, 9, 380, 2, 'claymore'],
];

// ------------------------------------------------------------------ derivation

const MODE: Record<string, FireMode> = { a: 'auto', s: 'semi', b2: 'burst2', b3: 'burst3', bolt: 'bolt', pump: 'pump', lever: 'lever', da: 'da', sa: 'sa', single: 'single' };
const HIP: Record<WeaponClass, number> = { handgun: 1.2, smg: 1.5, assault: 2.1, battle: 2.6, sniper: 4.6, classic: 3.0, shotgun: 1.4, mg: 3.2, launcher: 2.0, special: 1.5, melee: 0, thrown: 0 };
const RANGE: Record<WeaponClass, [number, number]> = { handgun: [55, 500], smg: [130, 520], assault: [400, 1700], battle: [650, 3300], sniper: [1000, 3500], classic: [500, 3300], shotgun: [45, 2500], mg: [700, 2500], launcher: [250, 1], special: [60, 1], melee: [2, 1], thrown: [30, 1] };
const BOX_RELOAD: Record<WeaponClass, number> = { handgun: 1.55, smg: 2.0, assault: 2.2, battle: 2.45, sniper: 2.8, classic: 2.6, shotgun: 2.6, mg: 3.1, launcher: 4.0, special: 2.0, melee: 0, thrown: 0 };

function blank(id: string, name: string, cls: WeaponClass, cc: string, year: number, look: string): WeaponDef {
  const [style, ...opts] = look.split(' ');
  return {
    id, name, cls, slot: 'gun', country: COUNTRY[cc] ?? cc, year, cal: '', calLabel: '', mass: 0.4, length: 0.3, barrel: 0, rpm: 0, mv: 0, mag: 0,
    modes: ['semi'], feed: 'none', look: { style, opts: new Set(opts) }, damage: 0, pellets: 1, bulletG: 0, drag: 0, pen: 0, range: 0, moa: 0,
    recoil: 0, recoilH: 0, hipSpread: 0, adsSpread: 0, pattern: 0, adsTime: 0.2, reload: 0, reloadEmpty: 0, perRound: 0, cycle: 0, mobility: 1,
    zoom: 1, scoped: false, suppressed: false, reserve: 0, proj: 'bullet', blast: null, sound: 'shotPistol', spin: 0, draw: 0, disposable: false,
    guided: false, tracer: 1, meleeDamage: 0, meleeRange: 0, meleeTime: 0, throwKind: '', fuse: 0, carry: 0,
    bars: { damage: 0, range: 0, accuracy: 0, rate: 0, mobility: 1, control: 1 }, energy: 0,
  };
}

/** Which recorded gunfire a cartridge is heard as (the weapon's class can still override it, see derive). */
const SOUND_OF: Record<string, SoundClass> = {
  '.22lr': 'shot22',
  '.32acp': 'shotPistol', '.380': 'shotPistol', '9x18': 'shotPistol', '9x19': 'shotPistol', '7.62x25': 'shotPistol', '7.63x25': 'shotPistol',
  '7.62x38r': 'shotPistol', '8x22': 'shotPistol', '.38spl': 'shotPistol',
  '.45acp': 'shot45', '.45colt': 'shot45', '.455': 'shot45', '.44-40': 'shot45',
  '.357': 'shotMagnum', '.44mag': 'shotMagnum', '.454': 'shotMagnum', '.500sw': 'shotMagnum', '.50ae': 'shotMagnum',
  '5.7x28': 'shotPdw', '4.6x30': 'shotPdw', '5.8x21': 'shotPdw',
  '5.56x45': 'shotAr', '5.8x42': 'shotAr', '4.73x33': 'shotAr', '.30carbine': 'shotAr', '.300blk': 'shotAr',
  '7.62x39': 'shotAk', '5.45x39': 'shotAk', '7.92x33': 'shotAk', '9x39': 'shotAk',
  '7.62x51': 'shotBattle', '6.8x51': 'shotBattle', '7.5x54': 'shotBattle', '7.5x55': 'shotBattle',
  '.30-06': 'shotGarand',
  '7.62x54r': 'shotBolt', '.303': 'shotBolt', '7.92x57': 'shotBolt', '7.7x58': 'shotBolt', '6.5x50': 'shotBolt', '6.5x52': 'shotBolt',
  '8x50r': 'shotBolt', '.30-30': 'shotBolt', '.45-70': 'shotBolt', '.577/450': 'shotBolt',
  '.300wm': 'shotSniper', '.338lm': 'shotSniper', '.338nm': 'shotSniper', '.408': 'shotSniper',
  '.50bmg': 'shotAmr', '12.7x108': 'shotAmr', '.55boys': 'shotAmr', '14.5x114': 'shotAmr', '20x82': 'shotAmr',
  // Black powder has no recording here; a shotgun's low boom is the nearest thing to it.
  '.75ball': 'shotShotgun', '.58minie': 'shotShotgun', '.50ball': 'shotShotgun', blunder: 'shotShotgun',
  '12ga': 'shotShotgun', '23mm': 'shotShotgun',
};

function derive(r: Row): WeaponDef {
  const [id, name, cls, cc, year, calId, kg, lenMM, bblMM, rpmIn, mv, mag, modeStr, look, x = {}] = r;
  const cal = CALIBERS[calId];
  if (!cal) throw new Error(`${id}: unknown caliber ${calId}`);
  const w = blank(id, name, cls, cc, year, look);
  const o = w.look.opts;
  const style = w.look.style;
  w.cal = calId;
  w.calLabel = cal.label;
  w.mass = kg;
  w.length = lenMM / 1000;
  w.barrel = bblMM / 1000;
  w.mv = mv;
  w.mag = mag;
  w.modes = modeStr.split(' ').map((m) => MODE[m]);
  w.proj = cal.proj ?? 'bullet';
  w.blast = cal.blast ?? null;
  w.pellets = cal.pellets ?? 1;
  w.bulletG = cal.g;
  w.drag = cal.k;
  w.pen = cal.pen;
  w.suppressed = o.has('sup');
  w.spin = x.spin ?? 0;
  w.disposable = x.disposable ?? false;
  w.guided = x.guided ?? false;
  const first = w.modes[0];
  const revolver = style === 'revolver';
  const manual = first === 'bolt' || first === 'pump' || first === 'lever';

  // Feed system
  let feed: Feed = 'box';
  if (x.feed) feed = x.feed;
  else if (w.proj === 'flame') feed = 'tank';
  else if (o.has('drum')) feed = 'drum';
  else if (o.has('pan')) feed = 'pan';
  else if (o.has('belt')) feed = 'belt';
  else if (o.has('helical')) feed = 'helical';
  else if (o.has('tube') || style === 'lever') feed = 'tube';
  else if (o.has('internal')) feed = 'internal';
  else if (o.has('enbloc')) feed = 'enbloc';
  else if (style === 'double') feed = 'double';
  else if (revolver && first !== 'single') feed = 'cyl';
  else if (first === 'single') feed = 'single';
  w.feed = feed;

  // Ballistics: muzzle energy -> damage.
  const E = 0.5 * (cal.g / 1000) * mv * mv;
  w.energy = E * w.pellets;
  if (w.proj === 'bullet' || w.proj === 'arrow') w.damage = 0.656 * Math.pow(E, 0.61) * (cal.mul ?? 1);
  else if (w.proj === 'flame') w.damage = 9;
  else if (w.proj === 'taser') w.damage = 6;
  else w.damage = 150;

  // Accuracy (minutes of angle)
  let moa = 4;
  if (cls === 'handgun') moa = revolver ? 5.5 : 7 * Math.sqrt(0.115 / Math.max(0.08, w.barrel)) * (first === 'auto' || first === 'burst3' ? 1.3 : 1);
  else if (cls === 'smg') moa = style === 'p90' || calId === '4.6x30' ? 4.5 : 5.5;
  else if (cls === 'assault') moa = 3.2 * (style === 'ak' ? 1.35 : 1) * (w.barrel < 0.3 ? 1.3 : 1);
  else if (cls === 'battle') moa = style === 'ak' ? 1.7 : 2.4;
  else if (cls === 'sniper') moa = style === 'chassis' ? (first === 'bolt' ? 0.6 : 0.8) : style === 'amr' ? 1.6 : 1.6;
  else if (cls === 'classic') moa = style === 'musket' ? (o.has('rifled') ? 6 : 22) : first === 'lever' ? 3.5 : first === 'single' ? 2.2 : 2.6;
  else if (cls === 'shotgun') moa = 12;
  else if (cls === 'mg') moa = style === 'minigun' ? 6 : style === 'hmg' ? 3.5 : 4.5;
  else if (cls === 'launcher') moa = w.guided ? 3 : w.proj === 'grenade' ? 20 : 14;
  else moa = style === 'crossbow' ? 4 : style === 'bow' ? 9 : 30;
  if (cls === 'battle' && (o.has('scope4') || o.has('scope6') || o.has('scope8') || o.has('acog') || o.has('pso'))) moa = Math.min(moa, 1.5);
  w.moa = moa;
  w.adsSpread = moa / 60;
  w.pattern = w.pellets > 1 ? (o.has('flare') ? 6.5 : o.has('sawn') ? 5.5 : w.barrel >= 0.7 ? 1.9 : 2.7) : 0;

  // Optics
  let zoom = cls === 'handgun' ? 1.15 : cls === 'smg' ? 1.25 : 1.3;
  if (o.has('scope12')) zoom = 12;
  else if (o.has('scope10')) zoom = 10;
  else if (o.has('scope8')) zoom = 8;
  else if (o.has('scope6')) zoom = 6;
  else if (o.has('scope4') || o.has('acog') || o.has('susat') || o.has('pso') || o.has('zf')) zoom = 4;
  else if (o.has('pu')) zoom = 3.5;
  else if (o.has('scout')) zoom = 2.5;
  else if (o.has('aug15')) zoom = 1.6;
  else if (o.has('dot') || o.has('holo')) zoom = 1.35;
  if (x.zoom) zoom = x.zoom;
  w.zoom = zoom;
  w.scoped = zoom >= 1.5;

  // Weight carried: gun + a loaded magazine.
  const loaded = kg + (w.proj === 'bullet' ? (mag * cal.g * w.pellets * 3) / 1000 + 0.1 : 0);
  w.mobility = clamp(1 - 0.017 * Math.max(0, loaded - 1.2), 0.5, 1);
  w.adsTime = clamp(0.09 + 0.033 * loaded + 0.075 * w.length, 0.12, 0.75);
  w.hipSpread = HIP[cls] * (1 + kg * 0.03);

  // Recoil from momentum: (bullet + propellant gas) / gun mass, scaled up for very energetic rounds.
  if (w.proj === 'bullet') {
    const impulse = w.pellets * (cal.g / 1000) * mv * (cls === 'handgun' ? 1.1 : cls === 'shotgun' ? 1.15 : 1.25);
    let rec = 0.42 * (impulse / loaded) * (1 + (E * w.pellets) / 8000);
    if (o.has('brake')) rec *= 0.82;
    if (o.has('bigbrake')) rec *= 0.6;
    if (o.has('sup')) rec *= 0.9;
    if (o.has('bal')) rec *= 0.6;
    if (o.has('nostock') && cls !== 'handgun') rec *= 1.25;
    if (style === 'minigun') rec *= 0.5;
    if (style === 'hmg') rec *= 0.7;
    w.recoil = clamp(rec, 0.12, 6.5);
  } else if (w.proj === 'grenade') w.recoil = 1.7;
  else if (w.proj === 'rocket') w.recoil = 0.9;
  else if (w.proj === 'arrow') w.recoil = 0.3;
  else w.recoil = w.proj === 'flame' ? 0.02 : 0.4;
  w.recoilH = w.recoil * 0.32;

  // Rate of fire and manual-action cycling
  w.cycle = x.cycle ?? (first === 'bolt' ? 1.15 : first === 'pump' ? (x.slam ? 0.48 : 0.62) : first === 'lever' ? 0.55 : first === 'sa' ? 0.45 : 0);
  if (rpmIn > 0) w.rpm = rpmIn;
  else if (manual || first === 'sa') w.rpm = Math.round(60 / (w.cycle + 0.12));
  else if (first === 'single') w.rpm = 600;
  else if (first === 'da') w.rpm = 240;
  else w.rpm = cls === 'handgun' ? 420 : cls === 'sniper' ? (E > 9000 ? 110 : 160) : cls === 'shotgun' ? 250 : cls === 'launcher' ? 70 : cls === 'battle' ? 300 : 360;
  if (x.burstRpm) (w as WeaponDef & { burstRpm?: number }).burstRpm = x.burstRpm;
  if (w.proj === 'arrow') w.draw = style === 'bow' ? 0.55 : 0;

  // Reloading
  let reload = 2.2;
  let perRound = 0;
  switch (feed) {
    case 'box':
      reload = BOX_RELOAD[cls] + (kg > 5 ? 0.3 : 0) + (o.has('top') || o.has('side') ? 0.2 : 0) + (style === 'bullpup' || o.has('bullpup') ? 0.25 : 0);
      break;
    case 'drum':
      reload = cls === 'shotgun' ? 3.2 : 3.5;
      break;
    case 'pan':
      reload = 4.3;
      break;
    case 'belt':
      reload = Math.min(8.5, 5.6 + kg * 0.04);
      break;
    case 'helical':
      reload = 3.0;
      break;
    case 'internal':
      reload = 2.9;
      break;
    case 'enbloc':
      reload = 2.2;
      break;
    case 'cyl':
      reload = 2.5;
      break;
    case 'gate':
      perRound = w.proj === 'grenade' ? 0.95 : 0.7;
      break;
    case 'tube':
      perRound = w.proj === 'grenade' ? 0.9 : first === 'lever' ? 0.6 : first === 'bolt' ? 0.7 : 0.52;
      break;
    case 'double':
      reload = 2.7;
      break;
    case 'tank':
      reload = 6;
      break;
    case 'single':
      if (style === 'musket') reload = 8.5;
      else if (w.proj === 'rocket') reload = w.disposable ? 2.4 : w.guided ? 5 : style === 'rpg' ? 3.6 : 4.0;
      else if (w.proj === 'grenade') reload = 2.5;
      else if (style === 'bow') reload = 0.9;
      else if (style === 'crossbow') reload = 2.8;
      else reload = 2.4;
      break;
    default:
      break;
  }
  w.perRound = perRound;
  w.reload = perRound ? perRound * mag + 0.8 : reload;
  w.reloadEmpty = perRound ? w.reload : reload + (feed === 'box' || feed === 'drum' || feed === 'pan' || feed === 'helical' || feed === 'belt' ? 0.35 : 0);

  // Effective range
  const [baseRange, refE] = RANGE[cls];
  if (w.proj === 'rocket') w.range = w.guided ? 600 : 300;
  else if (w.proj === 'grenade') w.range = 150;
  else if (w.proj === 'flame') w.range = 28;
  else if (w.proj === 'taser') w.range = 7;
  else if (w.proj === 'arrow' || w.proj === 'flare') w.range = 60;
  else if (style === 'musket') w.range = o.has('rifled') ? 300 : 80;
  else w.range = Math.round(baseRange * clamp(Math.pow((E * (w.pellets > 1 ? 1 : 1)) / refE, 0.25), 0.7, 1.5) * (w.scoped ? 1.2 : 1));
  if (cls === 'shotgun') w.range = o.has('sawn') ? 22 : 45;

  // Reserve ammunition
  if (cls === 'handgun') w.reserve = mag * (revolver ? 6 : 5);
  else if (cls === 'smg') w.reserve = mag * 5;
  else if (cls === 'assault' || cls === 'battle') w.reserve = mag * 6;
  else if (cls === 'sniper') w.reserve = Math.min(70, mag * (E > 9000 ? 5 : 7));
  else if (cls === 'classic') w.reserve = style === 'musket' ? 24 : mag === 1 ? 30 : mag * 10;
  else if (cls === 'shotgun') w.reserve = feed === 'drum' ? mag * 3 : 40;
  else if (cls === 'mg') w.reserve = feed === 'belt' ? Math.max(200, mag * 2) : mag * 5;
  else if (cls === 'launcher') w.reserve = w.proj === 'grenade' ? (mag >= 4 ? 18 : 12) : w.guided ? 2 : w.disposable ? 3 : mag > 1 ? 8 : 4;
  else w.reserve = w.proj === 'flame' ? mag * 2 : w.proj === 'arrow' ? 24 : 8;
  if (style === 'minigun') w.reserve = 600;

  // Sound: by what the weapon fires, because the cartridge is most of what a shot sounds like.
  const family = SOUND_OF[calId];
  let sound: SoundClass;
  if (w.proj === 'rocket') sound = 'shotLauncher';
  else if (w.proj === 'grenade' || w.proj === 'flare') sound = 'shotThump';
  else if (w.proj === 'arrow') sound = 'shotBow';
  else if (w.proj === 'taser') sound = 'shotTaser';
  else if (w.proj === 'flame') sound = 'flame';
  else if (w.suppressed) sound = E > 2500 ? 'shotSupHeavy' : 'shotSup';
  else if (cls === 'shotgun' || family === 'shotShotgun') sound = 'shotShotgun';
  else if (style === 'minigun') sound = 'shotMini';
  else if (cls === 'mg') sound = family === 'shotAmr' ? 'shotHmg' : family === 'shotAr' || family === 'shotAk' ? 'shotLmgLight' : 'shotLmg';
  else if (cls === 'smg' && family === 'shotPistol') sound = 'shotSmg';
  // A modern precision rifle in a service cartridge is still a sniper rifle to the ear: long barrel, brake.
  else if (cls === 'sniper' && (family === 'shotBattle' || family === 'shotGarand') && year >= 1960) sound = 'shotSniper';
  else sound = family ?? (E < 750 ? 'shotPistol' : E < 2400 ? 'shotAr' : E < 5200 ? 'shotBattle' : E < 11000 ? 'shotSniper' : 'shotAmr');
  w.sound = sound;
  w.tracer = cls === 'mg' ? 3 : 1;
  if (x.boost) (w as WeaponDef & { boost?: number }).boost = x.boost;
  if (x.slam) (w as WeaponDef & { slam?: boolean }).slam = true;

  // Armory bars
  const total = w.blast ? w.blast.dmg : w.damage * w.pellets;
  const dps = w.proj === 'flame' ? 90 : total;
  w.bars = {
    damage: clamp01(Math.log(Math.max(15, dps) / 14) / Math.log(700 / 14)),
    range: clamp01(Math.sqrt(w.range / 1500)),
    accuracy: 1 - clamp01(Math.log(moa / 0.5) / Math.log(30 / 0.5)),
    rate: Math.pow(clamp01(w.rpm / 1200), 0.7),
    mobility: (w.mobility - 0.5) / 0.5,
    control: 1 - clamp01(w.recoil / 4.5),
  };
  return w;
}

function deriveMelee(r: MeleeRow): WeaponDef {
  const [id, name, cc, year, dmg, range, time, look] = r;
  const w = blank(id, name, 'melee', cc, year, look);
  w.slot = 'melee';
  w.meleeDamage = dmg;
  w.meleeRange = range;
  w.meleeTime = time;
  w.calLabel = 'Edged / blunt';
  w.mass = w.look.style === 'sword' ? 1.2 : w.look.style === 'axe' ? 1.6 : 0.4;
  w.length = range * 0.32;
  w.range = range;
  w.rpm = Math.round(60 / time);
  w.bars = { damage: clamp01(dmg / 220), range: clamp01(range / 3), accuracy: 1, rate: clamp01(0.4 / time), mobility: 1, control: 1 };
  return w;
}

function deriveThrown(r: ThrownRow): WeaponDef {
  const [id, name, cc, year, kind, fuse, radius, dmg, carry, look] = r;
  const w = blank(id, name, 'thrown', cc, year, look);
  w.slot = 'thrown';
  w.throwKind = kind;
  w.fuse = fuse;
  w.carry = carry;
  w.mv = 17;
  w.calLabel = kind === 'frag' ? 'Fragmentation' : kind === 'impact' ? 'Impact fuze' : kind === 'stun' ? 'Flash-bang' : kind === 'fire' ? 'Incendiary' : kind === 'smoke' ? 'Smoke screen' : kind === 'remote' ? 'Remote detonation' : 'Directional mine';
  w.blast = { r: radius, dmg, fire: kind === 'fire', stun: kind === 'stun' };
  w.range = 30;
  w.bars = { damage: clamp01(dmg / 450), range: clamp01(radius / 10), accuracy: 0.5, rate: 0.2, mobility: 1, control: 1 };
  return w;
}

export const WEAPONS: WeaponDef[] = [...GUNS.map(derive), ...MELEE.map(deriveMelee), ...THROWN.map(deriveThrown)];
const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}
export const hasWeapon = (id: string) => BY_ID.has(id);
export const weaponsOfClass = (cls: WeaponClass) => WEAPONS.filter((w) => w.cls === cls);
export const burstRpm = (w: WeaponDef) => (w as WeaponDef & { burstRpm?: number }).burstRpm ?? 0;
export const boostSpeed = (w: WeaponDef) => (w as WeaponDef & { boost?: number }).boost ?? 0;
export const slamFire = (w: WeaponDef) => (w as WeaponDef & { slam?: boolean }).slam === true;
export type { Projectile };
