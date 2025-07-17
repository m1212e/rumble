//TODO fix subscription tests
// import { beforeEach, describe, expect, test } from "bun:test";
// import { and, eq } from "drizzle-orm";
// import { parse } from "graphql";
// import { assertFindFirstExists, assertFirstEntryExists } from "../../lib";
// import { makeSeededDBInstanceForTest } from "./db/db";
// import * as schema from "./db/schema";
// import { makeRumbleSeedInstance } from "./rumble/baseInstance";

// describe("test rumble subscriptions", async () => {
// 	let { db, data } = await makeSeededDBInstanceForTest();
// 	let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

// 	beforeEach(async () => {
// 		const s = await makeSeededDBInstanceForTest();
// 		db = s.db;
// 		data = s.data;

// 		const r = makeRumbleSeedInstance(db, data.users.at(0)?.id);
// 		rumble = r.rumble;
// 		build = r.build;
// 	});

// 	test("deliver subscription updates on specific entity", async () => {
// 		rumble.abilityBuilder.comments.allow("read");
// 		rumble.abilityBuilder.comments.allow("update");

// 		const { updated: updatedComment } = rumble.pubsub({
// 			table: "comments",
// 		});

// 		rumble.schemaBuilder.mutationFields((t) => {
// 			return {
// 				updateComment: t.drizzleField({
// 					args: {
// 						id: t.arg.string({ required: true }),
// 						newText: t.arg.string({ required: true }),
// 					},
// 					type: "comments",
// 					resolve: (query, root, args, ctx, info) => {
// 						updatedComment(args.id);
// 						return db
// 							.update(schema.comments)
// 							.set({
// 								text: args.newText,
// 							})
// 							.where(
// 								and(
// 									eq(schema.comments.id, args.id),
// 									ctx.abilities.comments.filter("update").sql.where,
// 								),
// 							)
// 							.returning({
// 								id: schema.comments.id,
// 								published: schema.comments.published,
// 								ownerId: schema.comments.ownerId,
// 								postId: schema.comments.postId,
// 								text: schema.comments.text,
// 							})
// 							.then(assertFirstEntryExists);
// 					},
// 				}),
// 			};
// 		});

// 		let currentText = data.comments[0].text;
// 		const commentId = data.comments[0].id;

// 		const { executor, yogaInstance } = build();
// 		const sub: any = await executor({
// 			document: parse(/* GraphQL */ `
//                 subscription FindFirstComment {
//                   findFirstComments(where: { id: "${commentId}" }) {
//                     id
//                     text
//                   }
//                 }
//               `),
// 		});

// 		const interval = setInterval(async () => {
// 			currentText = "dawawdawdawdawdwad";
// 			const r = await executor({
// 				document: parse(/* GraphQL */ `
//               mutation SetTextOnComment {
//                 updateComment(id: "${commentId}", newText: "${currentText}") {
//                   id
//                   text
//                 }
//               }
//             `),
// 			});

// 			if ((r as any).errors) {
// 				throw (r as any).errors;
// 			}
// 		}, 300);

// 		let iterationCounter = 0;
// 		for await (const message of sub) {
// 			iterationCounter++;
// 			expect(message).toEqual({
// 				data: {
// 					findFirstComments: {
// 						id: commentId,
// 						text: currentText,
// 					},
// 				},
// 			});

// 			if (iterationCounter === 3) {
// 				clearInterval(interval);
// 				break;
// 			}
// 		}

// 		expect(iterationCounter).toEqual(3);
// 	});

// 	test("deliver subscription updates on list of entities", async () => {
// 		rumble.abilityBuilder.comments.allow("read");
// 		rumble.abilityBuilder.comments.allow("update");

// 		const { updated: updatedComment } = rumble.pubsub({
// 			table: "comments",
// 		});

// 		rumble.schemaBuilder.mutationFields((t) => {
// 			return {
// 				updateComment: t.drizzleField({
// 					args: {
// 						id: t.arg.string({ required: true }),
// 						newText: t.arg.string({ required: true }),
// 					},
// 					type: "comments",
// 					resolve: (query, root, args, ctx, info) => {
// 						updatedComment(args.id);
// 						return db
// 							.update(schema.comments)
// 							.set({
// 								text: args.newText,
// 							})
// 							.where(
// 								and(
// 									eq(schema.comments.id, args.id),
// 									ctx.abilities.comments.filter("update").sql.where,
// 								),
// 							)
// 							.returning({
// 								id: schema.comments.id,
// 								published: schema.comments.published,
// 								ownerId: schema.comments.ownerId,
// 								postId: schema.comments.postId,
// 								text: schema.comments.text,
// 							})
// 							.then(assertFirstEntryExists);
// 					},
// 				}),
// 			};
// 		});

// 		let currentText = data.comments[0].text;
// 		const commentId = data.comments[0].id;

// 		const { executor, yogaInstance } = build();
// 		const sub = await executor({
// 			document: parse(/* GraphQL */ `
//                 subscription FindFirstComment {
//                   comments(where: { id: "${commentId}" }) {
//                     id
//                     text
//                   }
//                 }
//               `),
// 		});

// 		const interval = setInterval(async () => {
// 			currentText = "dawadwawdawd12radadw";
// 			const r = await executor({
// 				document: parse(/* GraphQL */ `
//               mutation SetTextOnComment {
//                 updateComment(id: "${commentId}", newText: "${currentText}") {
//                   id
//                   text
//                 }
//               }
//             `),
// 			});

// 			if ((r as any).errors) {
// 				throw (r as any).errors;
// 			}
// 		}, 300);

// 		let iterationCounter = 0;
// 		for await (const message of sub) {
// 			iterationCounter++;
// 			expect(message).toEqual({
// 				data: {
// 					comments: [
// 						{
// 							id: commentId,
// 							text: currentText,
// 						},
// 					],
// 				},
// 			});

// 			if (iterationCounter === 3) {
// 				clearInterval(interval);
// 				break;
// 			}
// 		}

// 		expect(iterationCounter).toEqual(3);
// 	});

// 	test("deliver subscription deletions on list of entities", async () => {
// 		rumble.abilityBuilder.comments.allow("read");
// 		rumble.abilityBuilder.comments.allow("delete");

// 		const { removed: deletedComment } = rumble.pubsub({
// 			table: "comments",
// 		});

// 		rumble.schemaBuilder.mutationFields((t) => {
// 			return {
// 				deleteComment: t.drizzleField({
// 					args: {
// 						id: t.arg.string({ required: true }),
// 					},
// 					type: "comments",
// 					resolve: async (query, root, args, ctx, info) => {
// 						const comment = await db.query.comments
// 							.findFirst(
// 								query({
// 									where: ctx.abilities.comments.filter("delete", {
// 										inject: {
// 											where: {
// 												id: args.id,
// 											},
// 										},
// 									}).query.single.where,
// 								}),
// 							)
// 							.then(assertFindFirstExists);

// 						await db
// 							.delete(schema.comments)
// 							.where(eq(schema.comments.id, comment.id));
// 						deletedComment();

// 						return comment;
// 					},
// 				}),
// 			};
// 		});

// 		const commentId = data.comments[0].id;
// 		const { executor, yogaInstance } = build();
// 		const sub = await executor({
// 			document: parse(/* GraphQL */ `
//                 subscription FindFirstComment {
//                   comments(where: { id: "${commentId}" }) {
//                     id
//                     text
//                   }
//                 }
//               `),
// 		});

// 		setTimeout(async () => {
// 			const r = await executor({
// 				document: parse(/* GraphQL */ `
//               mutation SetTextOnComment {
//                 deleteComment(id: "${commentId}") {
//                   id
//                   text
//                 }
//               }
//             `),
// 			});

// 			if ((r as any).errors) {
// 				throw (r as any).errors;
// 			}
// 		}, 300);

// 		let iterationCounter = 0;
// 		for await (const message of sub) {
// 			iterationCounter++;

// 			if (iterationCounter === 1) {
// 				expect(message).toEqual({
// 					data: {
// 						comments: [
// 							{
// 								id: commentId,
// 								text: data.comments[0].text,
// 							},
// 						],
// 					},
// 				});
// 			}

// 			if (iterationCounter === 2) {
// 				expect(message).toEqual({
// 					data: {
// 						comments: [],
// 					},
// 				});
// 				break;
// 			}
// 		}

// 		expect(iterationCounter).toEqual(2);
// 	});

// 	test("deliver subscription creations on list of entities", async () => {
// 		rumble.abilityBuilder.comments.allow("read");
// 		rumble.abilityBuilder.comments.allow("delete");

// 		const { created: createdComment } = rumble.pubsub({
// 			table: "comments",
// 		});

// 		rumble.schemaBuilder.mutationFields((t) => {
// 			return {
// 				createComment: t.drizzleField({
// 					args: {
// 						id: t.arg.string({ required: true }),
// 						text: t.arg.string({ required: true }),
// 					},
// 					type: "comments",
// 					resolve: async (query, root, args, ctx, info) => {
// 						const comment = await db
// 							.insert(schema.comments)
// 							.values({
// 								id: args.id,
// 								text: args.text,
// 								ownerId: data.users[0].id,
// 							})
// 							.returning()
// 							.then(assertFirstEntryExists);
// 						createdComment();

// 						return await db.query.comments
// 							.findFirst(
// 								query(
// 									ctx.abilities.comments.filter("read", {
// 										inject: {
// 											where: { id: comment.id },
// 										},
// 									}).query.single,
// 								),
// 							)
// 							.then(assertFindFirstExists);
// 					},
// 				}),
// 			};
// 		});

// 		const commentId = "c2b3e3e5-998e-4597-a38a-b104109b0301";
// 		const text = "daawdadw adwawd wadad awdawd!";
// 		const { executor, yogaInstance } = build();
// 		const sub = await executor({
// 			document: parse(/* GraphQL */ `
//         subscription FindFirstComment {
//           comments {
//             id
//             text
//           }
//         }
//       `),
// 		});

// 		setTimeout(async () => {
// 			const r = await executor({
// 				document: parse(/* GraphQL */ `
//               mutation SetTextOnComment {
//                 createComment(id: "${commentId}", text: "${text}") {
//                   id
//                   text
//                 }
//               }
//             `),
// 			});

// 			if ((r as any).errors) {
// 				throw (r as any).errors;
// 			}
// 		}, 300);

// 		let iterationCounter = 0;
// 		for await (const message of sub) {
// 			iterationCounter++;

// 			if (iterationCounter === 1) {
// 				expect(message.data.comments.length).toEqual(200);
// 			}

// 			if (iterationCounter === 2) {
// 				expect(message.data.comments.length).toEqual(201);
// 				break;
// 			}
// 		}

// 		expect(iterationCounter).toEqual(2);
// 	});
// });
