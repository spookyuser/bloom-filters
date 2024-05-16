const tseslint = require('typescript-eslint')

module.exports = {
    "root": true,
    "extends": ["plugin:@typescript-eslint/strict-type-checked"],
    "parser": "@typescript-eslint/parser",
    "parserOptions": { "project": ["./tsconfig.eslint.json"] },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": { 
        "no-console": "error",
    },
    "ignorePatterns": [
        "./*.config.*",
        "./dist/**/*",
        "./examples/**/*"
    ]
}