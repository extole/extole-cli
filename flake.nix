{
  description = "Extole developer CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pkgs.git
            pkgs.gh
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            if [ ! -d node_modules ]; then
              echo "Installing npm dependencies..."
              npm install --no-fund --no-audit 2>/dev/null
            fi
          '';
        };
      }
    );
}
