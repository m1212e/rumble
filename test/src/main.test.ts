import { beforeAll } from "bun:test";
import { faker } from "@faker-js/faker";

beforeAll(async () => {
	faker.seed(123);
});
