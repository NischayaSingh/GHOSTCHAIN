#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p zk/build apps/web/public/zk
bin=node_modules/.bin
out=zk/build
public=apps/web/public/zk
"$bin/circom2" zk/cell_membership.circom --r1cs --wasm --O2 -o "$out"
"$bin/tsx" zk/input.mjs
if [[ ! -f "$out/phase2-12.ptau" ]]; then
  "$bin/snarkjs" powersoftau new bn128 12 "$out/pot0.ptau"
  "$bin/snarkjs" powersoftau contribute "$out/pot0.ptau" "$out/pot1.ptau" --name='GHOSTCHAIN local phase 1' -e="$(openssl rand -hex 32)"
  "$bin/snarkjs" powersoftau prepare phase2 "$out/pot1.ptau" "$out/phase2-12.ptau"
fi
"$bin/snarkjs" groth16 setup "$out/cell_membership.r1cs" "$out/phase2-12.ptau" "$out/initial.zkey"
"$bin/snarkjs" zkey contribute "$out/initial.zkey" "$out/membership.zkey" --name='GHOSTCHAIN local phase 2' -e="$(openssl rand -hex 32)"
"$bin/snarkjs" zkey export verificationkey "$out/membership.zkey" "$public/verification_key.json"
"$bin/snarkjs" groth16 fullprove "$out/input.json" "$out/cell_membership_js/cell_membership.wasm" "$out/membership.zkey" "$public/proof.json" "$public/public.json"
npm run zk:verify
