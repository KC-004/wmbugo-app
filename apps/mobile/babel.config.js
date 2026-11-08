module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // drizzle-kit (driver: 'expo') emits drizzle/migrations.js that imports
  // each .sql file as a string; inline-import turns that into a literal.
  plugins: [['inline-import', { extensions: ['.sql'] }]],
};
