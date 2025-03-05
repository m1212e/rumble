// https://stackoverflow.com/a/1026087/11988368
export function capitalizeFirstLetter(val: string) {
	return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}
