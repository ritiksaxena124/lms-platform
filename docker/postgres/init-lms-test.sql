-- The host gate (`bun run verify`) runs the API suites against lms_test. The image does not need this
-- database, but a stack that can also serve the tests costs one statement and saves the next reader
-- discovering the difference by hand.
CREATE DATABASE lms_test;
