pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

template CellMembership(depth) {
    signal input root;
    signal input position;
    signal input digest;
    signal input siblings[depth];
    signal input direction[depth];

    component leaf = Poseidon(1);
    leaf.inputs[0] <== digest;

    signal nodes[depth + 1];
    signal positions[depth + 1];
    nodes[0] <== leaf.out;
    positions[0] <== 0;

    component parents[depth];
    for (var i = 0; i < depth; i++) {
        direction[i] * (direction[i] - 1) === 0;
        positions[i + 1] <== positions[i] + direction[i] * (2 ** i);
        parents[i] = Poseidon(2);
        parents[i].inputs[0] <== nodes[i] + direction[i] * (siblings[i] - nodes[i]);
        parents[i].inputs[1] <== siblings[i] + direction[i] * (nodes[i] - siblings[i]);
        nodes[i + 1] <== parents[i].out;
    }

    root === nodes[depth];
    position === positions[depth];
}

component main {public [root, position]} = CellMembership(3);
