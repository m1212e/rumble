import { rumble } from "../../lib";

const { abilityBuilder, schemaBuilder, arg, object, query, pubsub, yoga } =
	rumble({
		db,
		context(request) {
			return {
				user: users.at(0),
			};
		},
	});

abilityBuilder.users.allow(["read", "update", "delete"]).when(({ user }) => {
	if (user) {
		return { where: eq(schema.users.id, user.id) };
	}
});

abilityBuilder.posts.allow("read").when({});
