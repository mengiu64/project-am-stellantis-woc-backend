import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'test/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                // Node.js globals
                console: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                Buffer: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                global: 'readonly',
                // Jest globals
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly'
            }
        },
        rules: {
            // Best practices
            'no-console': 'off',  // Allowed in Lambda for CloudWatch logs
            'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
            'no-var': 'error',
            'prefer-const': 'error',
            'prefer-arrow-callback': 'warn',
            'arrow-spacing': 'error',
            
            // Code quality
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'all'],
            'brace-style': ['error', '1tbs'],
            'comma-dangle': ['error', 'never'],
            'quotes': ['error', 'single', { 'avoidEscape': true }],
            'semi': ['error', 'always'],
            
            // Spacing
            'indent': ['error', 2],
            'space-before-function-paren': ['error', {
                'anonymous': 'always',
                'named': 'never',
                'asyncArrow': 'always'
            }],
            'space-before-blocks': 'error',
            'keyword-spacing': 'error',
            'object-curly-spacing': ['error', 'always']
        }
    },
    {
        ignores: [
            'node_modules/',
            'coverage/',
            '*.zip',
            '*.log',
            '.github/',
            'config/',
            'docs/',
            'scripts/'
        ]
    }
];
