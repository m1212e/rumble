export class RumbleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RumbleError";
	}
}
