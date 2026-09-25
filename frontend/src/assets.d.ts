// Vite turns an imported image into its hashed URL.
declare module "*.png" {
  const url: string;
  export default url;
}
