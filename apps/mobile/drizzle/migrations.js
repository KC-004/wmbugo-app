// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_hesitant_excalibur.sql';
import m0001 from './0001_superb_harry_osborn.sql';
import m0002 from './0002_faulty_shatterstar.sql';
import m0003 from './0003_mysterious_barracuda.sql';
import m0004 from './0004_keen_trish_tilby.sql';
import m0005 from './0005_steep_hex.sql';
import m0006 from './0006_heavy_yellow_claw.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006
    }
  }
  