import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['DRAFT_firestore.rules', 'firestore.rules'],
    ...firebaseRulesPlugin.configs['flat/recommended'],
  },
];
