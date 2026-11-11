// Shared by the web page (window.TL) and the server (require('./public/shared.js')).
(function (root) {
// Groups appear at the top of the Controller list. Members are matched by
// controller name (case-insensitive); offline controllers are skipped.
  const GROUPS = [
  { id: 'all', label: '★ All lights', names: null },
  { id: 'backyard', label: '★ Backyard (Back, Pergola, Landscape)', names: ['Trimlight Back', 'Pergola', 'Trimlight Landscape'] },
];

// Mode numbers match the Animation list:
//  0 Static · 1 Chase fwd · 2 Chase back · 3 Chase mid→out · 5 Stars · 6 Breath · 7 Comet fwd · 8 Comet back
//  9 Comet mid→out · 11 Wave fwd · 12 Wave back · 13 Wave mid→out · 16 Fade
// Every theme starts at full brightness (255); the Brightness slider can dim it.
const T = (name, note, colors, mode, ledsPerColor, brightness, speed) => ({ name, note, colors, mode, ledsPerColor, brightness, speed });

const HOLIDAYS = [
  { id: 'christmas', label: '🎄 Christmas', themes: [
    T('Classic Christmas', 'Red & green chasing', ['#ff0000', '#00c800'], 1, 4, 255, 40),
    T('Candy Cane', 'Red & white stripes', ['#ff0000', '#ffffff'], 1, 4, 255, 60),
    T('Peppermint Twist', 'Red, white & pink swirl', ['#ff0000', '#ffffff', '#ff4f8b', '#ffffff'], 13, 3, 255, 90),
    T('Santa\'s Sleigh', 'Red & gold racing comets', ['#ff0000', '#ffd27f', '#ffb300'], 7, 4, 255, 170),
    T('Rudolph', 'One red nose leading the way', ['#ff0000', '#ffd8a0', '#ffd8a0', '#ffd8a0', '#ffd8a0'], 7, 3, 255, 120),
    T('Winter Wonderland', 'Icy blue & white twinkle', ['#ffffff', '#7fd4ff', '#2a7fff', '#d6f2ff'], 5, 2, 255, 80),
    T('Let It Snow', 'Snow drifting down', ['#ffffff', '#cfe9ff', '#ffffff', '#5aa9ff'], 8, 3, 255, 60),
    T('Christmas Eve', 'Soft twinkling warm white', ['#ffd27f', '#ffb347', '#fff1d6'], 5, 2, 255, 60),
    T('Silver & Gold', 'Elegant slow fade', ['#ffc400', '#fff1d6', '#ffffff', '#ffb000'], 16, 6, 255, 35),
    T('Retro Bulbs', 'Old-school multicolor C9 bulbs', ['#ff0000', '#00c800', '#0040ff', '#ff8c00', '#ffd400'], 0, 3, 255, 0),
    T('Holly Jolly', 'Green, red & gold breathing', ['#00a000', '#ff0000', '#ffb300'], 6, 5, 255, 55),
    T('Gingerbread House', 'Spice, icing & candy', ['#b84a00', '#ffffff', '#ff0000', '#b84a00', '#ffffff', '#00c800'], 0, 3, 255, 0),
    T('The Grinch', 'Grinch green with a red heart', ['#5aff00', '#5aff00', '#5aff00', '#ff0000'], 6, 4, 255, 70),
    T('Nutcracker', 'Red, gold & royal blue march', ['#ff0000', '#ffb300', '#1a3cff'], 11, 4, 255, 90),
    T('Blue Christmas', 'Deep blue & white glow', ['#0030ff', '#ffffff'], 6, 5, 255, 45),
    T('Elf Party', 'Fast & fun red, green, white, yellow', ['#ff0000', '#00c800', '#ffffff', '#ffd400'], 2, 3, 255, 200),
    T('Northern Lights', 'Teal, green & purple waves', ['#00ffa0', '#00b4ff', '#7a00ff', '#00ff40'], 11, 8, 255, 50),
    T('Midnight Mass', 'Gold & warm white from the center', ['#ffb300', '#fff1d6', '#ffd27f'], 9, 4, 255, 70),
    T('Christmas Tree', 'Green with colorful ornaments', ['#00a000', '#00a000', '#ff0000', '#00a000', '#00a000', '#ffd400', '#00a000', '#00a000', '#0040ff'], 0, 2, 255, 0),
    T('Retro Bulbs Chase', 'Classic multicolor bulbs on the move', ['#ff0000', '#00c800', '#0040ff', '#ff8c00', '#ffd400'], 1, 3, 255, 45),
    T('Frosty', 'Snow white, icy blue & a carrot nose', ['#ffffff', '#ffffff', '#9fdfff', '#ff6a00'], 8, 3, 255, 70),
    T('Icicles', 'White & ice blue dripping down', ['#ffffff', '#cfefff', '#5aa9ff'], 10, 3, 255, 110),
    T('Snowflake Sparkle', 'Crisp white & blue twinkle', ['#ffffff', '#9fdfff', '#ffffff', '#2a7fff'], 5, 2, 255, 140),
    T('Silent Night', 'Deep blue & warm white, slow fade', ['#001a80', '#ffd27f'], 16, 6, 255, 25),
    T('Polar Express', 'Gold headlight racing through night blue', ['#ffc400', '#fff1d6', '#001a80', '#001a80'], 7, 4, 255, 190),
    T('Jingle Bells', 'Gold, red & white ringing outward', ['#ffc400', '#ff0000', '#ffffff'], 3, 3, 255, 140),
    T('Christmas Morning', 'Red, green, gold & white rushing in', ['#ff0000', '#00c800', '#ffc400', '#ffffff'], 14, 4, 255, 100),
    T('Sugar Plum Fairy', 'Purple, pink & silver twinkle', ['#8000ff', '#ff4fb0', '#e6e6ff'], 5, 2, 255, 90),
    T('Hot Cocoa', 'Cozy chocolate & marshmallow glow', ['#8b4513', '#ffd8a0', '#c86414'], 6, 5, 255, 40),
    T('Mistletoe', 'Evergreen with white berries', ['#00a000', '#00a000', '#ffffff'], 0, 3, 255, 0),
    T('Evergreen', 'Two greens & warm white, steady', ['#00a000', '#3cff3c', '#ffd27f'], 0, 4, 255, 0),
    T('Ugly Sweater', 'Loud & fun red, green, white, blue, yellow', ['#ff0000', '#00c800', '#ffffff', '#0040ff', '#ffd400'], 2, 2, 255, 220),
    T('Red & White Twinkle', 'Classic red with warm white sparkles', ['#ff0000', '#ff0000', '#ffd8a0'], 5, 2, 255, 100),
    T('Merry & Bright', 'Every color waving back and forth', ['#ff0000', '#ff8000', '#ffd400', '#00c800', '#00b4ff', '#8000ff'], 12, 4, 255, 80),
  ]},
  { id: 'thanksgiving', label: '🦃 Thanksgiving', themes: [
    T('Harvest Glow', 'Warm amber & gold, steady', ['#ff6a00', '#ffb000', '#ff8c00'], 0, 5, 255, 0),
    T('Autumn Leaves', 'Red, orange & gold drifting', ['#c81e00', '#ff5a00', '#ffb300', '#ff7a00'], 1, 4, 255, 35),
    T('Pumpkin Pie', 'Pumpkin orange with cream', ['#ff5000', '#ff5000', '#ffd9a0'], 0, 3, 255, 0),
    T('Cranberry & Gold', 'Slow breathing glow', ['#b0002a', '#ffb300'], 6, 6, 255, 50),
    T('Candlelight Dinner', 'Soft flickering warm white', ['#ffb347', '#ff8c1a', '#ffd27f'], 5, 2, 255, 70),
    T('Turkey Trot', 'Festive moving wave', ['#8b2500', '#ff6a00', '#ffc400', '#c81e00'], 11, 5, 255, 120),
    T('Golden Hour', 'Gold fading to sunset', ['#ffc400', '#ff7a00', '#ff3c00'], 16, 8, 255, 40),
    T('Gratitude', 'Gold comets from the center', ['#ffd27f', '#ff9a00', '#ffffff'], 9, 4, 255, 90),
    T('Cornucopia', 'Harvest orange, gold, red & squash green', ['#ff6a00', '#ffc400', '#c81e00', '#6b8e23', '#b84a00'], 0, 4, 255, 0),
    T('Falling Leaves', 'Red, orange & gold tumbling down', ['#c81e00', '#ff5a00', '#ffb300'], 8, 3, 255, 60),
    T('Cozy Fireplace', 'Flickering red, orange & amber', ['#ff2a00', '#ff6a00', '#ffb000', '#ff4000'], 5, 2, 255, 150),
    T('Harvest Moon', 'Deep orange & soft white rising and falling', ['#ff5000', '#fff1d6'], 6, 6, 255, 35),
    T('Apple Cider', 'Warm amber & apple red waves', ['#ff9a00', '#c81e00', '#ffb347'], 12, 5, 255, 50),
    T('Pecan Pie', 'Toasty brown, amber & cream', ['#8b4513', '#ff9a00', '#ffd9a0'], 0, 3, 255, 0),
    T('Maple Glow', 'Maple red & orange breathing', ['#c81e00', '#ff6a00'], 6, 5, 255, 45),
    T('Indian Corn', 'Gold, red, deep purple & orange kernels', ['#ffc400', '#c81e00', '#5a0080', '#ff6a00'], 0, 2, 255, 0),
    T('Football Sunday', 'Pigskin brown & white laces on the run', ['#8b4513', '#8b4513', '#ffffff'], 1, 3, 255, 150),
    T('Give Thanks', 'Gold & warm white gathering in', ['#ffc400', '#fff1d6'], 4, 4, 255, 70),
    T('Sweet Potato', 'Orange & golden brown fade', ['#ff6a00', '#c86414', '#ffb000'], 16, 6, 255, 35),
    T('Gobble Gobble', 'Turkey feathers fanning out from the middle', ['#8b2500', '#ff6a00', '#ffc400', '#c81e00', '#ffffff'], 13, 3, 255, 100),
  ]},
  { id: 'patriotic', label: '🇺🇸 Patriotic', themes: [
    T('Old Glory', 'Bold red, white & blue', ['#ff0000', '#ffffff', '#0030ff'], 0, 4, 255, 0),
    T('Stars & Stripes', 'Red & white stripes with a blue field', ['#ff0000', '#ffffff', '#ff0000', '#ffffff', '#0030ff', '#0030ff'], 1, 3, 255, 35),
    T('Waving Flag', 'Red, white & blue rippling like a flag', ['#ff0000', '#ffffff', '#0030ff'], 12, 5, 255, 60),
    T('Star-Spangled Sparkle', 'Deep blue sky with twinkling white stars', ['#0030ff', '#0030ff', '#ffffff'], 5, 2, 255, 110),
    T('Rockets\' Red Glare', 'Red rockets streaking across night blue', ['#ff0000', '#001a80', '#001a80'], 7, 4, 255, 200),
    T('Grand Finale', 'Red, white & blue bursting from the center', ['#ff0000', '#ffffff', '#0030ff', '#ffffff'], 9, 3, 255, 230),
    T('Firecracker', 'Fast red & white crackle', ['#ff0000', '#ffffff'], 2, 2, 255, 220),
    T('Sparkler', 'White & gold sparkles', ['#ffffff', '#ffc400', '#fff1d6'], 5, 1, 255, 200),
    T('Liberty Wave', 'Red, white & blue waves rolling by', ['#ff0000', '#ffffff', '#0030ff'], 11, 6, 255, 70),
    T('Freedom Ring', 'Red, white & blue ringing out from the middle', ['#ff0000', '#ffffff', '#0030ff'], 3, 3, 255, 110),
    T('Proud & True', 'Red, white & blue breathing slowly', ['#ff0000', '#ffffff', '#0030ff'], 6, 5, 255, 40),
    T('Honor & Remember', 'Veterans Day: soft warm white with red & blue, slow fade', ['#ffd27f', '#ff0000', '#ffd27f', '#0030ff'], 16, 6, 255, 25),
    T('Salute to Service', 'Veterans Day: olive drab, gold & white', ['#4b5320', '#ffc400', '#ffffff'], 6, 5, 255, 35),
    T('Yellow Ribbon', 'Support our troops: yellow & warm white', ['#ffd400', '#ffd400', '#ffd8a0'], 0, 3, 255, 0),
    T('Purple Heart', 'Purple & gold honoring the wounded', ['#7a00ff', '#ffc400'], 6, 5, 255, 40),
    T('Anchors Aweigh', 'Navy blue & white rolling out to sea', ['#001a80', '#ffffff', '#0030ff'], 13, 4, 255, 60),
  ]},
  // Team colors tuned for LEDs (true team navy/gold read too dark on lights, so they're brightened).
  { id: 'gameday', label: '🏈 Game Day', themes: [
    T('49ers Red & Gold', 'Scarlet & gold, steady', ['#e00000', '#ffb000'], 0, 4, 255, 0),
    T('Niners Faithful', 'Scarlet, gold & white marching along', ['#e00000', '#ffb000', '#ffffff'], 1, 4, 255, 70),
    T('Gold Rush', 'Gold comets racing over scarlet', ['#ffb000', '#ffd27f', '#e00000', '#e00000'], 7, 4, 255, 190),
    T('Niners Wave', 'Scarlet & gold rolling like the crowd', ['#e00000', '#ffb000'], 11, 6, 255, 90),
    T('49ers Sparkle', 'Scarlet with twinkling gold', ['#e00000', '#e00000', '#ffb000'], 5, 2, 255, 130),
    T('49ers Touchdown!', 'Scarlet, gold & white celebration', ['#e00000', '#ffb000', '#ffffff'], 9, 3, 255, 240),
    T('Braves Navy & Red', 'Navy, red & white, steady', ['#0a2a9a', '#e0102a', '#ffffff'], 0, 4, 255, 0),
    T('Braves Country', 'Navy & red breathing', ['#0a2a9a', '#e0102a'], 6, 5, 255, 45),
    T('Braves Wave', 'Red, white & navy rolling by', ['#e0102a', '#ffffff', '#0a2a9a'], 11, 5, 255, 80),
    T('Braves Twinkle', 'Navy sky with red & white sparkles', ['#0a2a9a', '#0a2a9a', '#e0102a', '#ffffff'], 5, 2, 255, 120),
    T('Braves Home Run', 'Red & white bursting from the center', ['#e0102a', '#ffffff', '#0a2a9a'], 9, 3, 255, 220),
    T('Braves Win!', 'Fast red, white & navy celebration', ['#e0102a', '#ffffff', '#0a2a9a'], 2, 2, 255, 230),
  ]},
  { id: 'more', label: '🎉 More', themes: [
    T('Warm White', 'Classic everyday white', ['#ffb060'], 0, 1, 255, 0),
    T('Halloween', 'Orange & purple', ['#ff5000', '#7a00ff'], 0, 4, 255, 0),
    T('Spooky', 'Orange, purple & green creeping', ['#ff5000', '#7a00ff', '#3cff00'], 1, 3, 255, 50),
    T('USA', 'Red, white & blue', ['#ff0000', '#ffffff', '#0000ff'], 0, 4, 255, 0),
    T('Fireworks', 'Red, white & blue bursts', ['#ff0000', '#ffffff', '#0000ff'], 9, 3, 255, 160),
    T('St. Patrick\'s', 'Green & white', ['#00c000', '#ffffff'], 0, 4, 255, 0),
    T('Valentine\'s', 'Pink, red & white', ['#ff2080', '#ff0000', '#ffffff'], 6, 3, 255, 60),
    T('Easter', 'Soft pastels', ['#ff8cc8', '#a0e0ff', '#fff080', '#c0ff90', '#c8a0ff'], 0, 3, 255, 0),
    T('New Year\'s Eve', 'Gold & silver sparkle', ['#ffc400', '#ffffff', '#fff1d6'], 5, 2, 255, 120),
  ]},
];


  const findTheme = (holidayId, name) => {
    const h = HOLIDAYS.find(x => x.id === holidayId);
    return h && h.themes.find(t => t.name === name);
  };

  const TL = { GROUPS, HOLIDAYS, findTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = TL;
  else root.TL = TL;
})(typeof window !== 'undefined' ? window : globalThis);
