// Package experiencev1 owns ElseLife's immutable canonical boundary bytes and pin.
package experiencev1

import _ "embed"

const Revision = "685758b9009c647f0b6b0da2dbe1769ea6964a71"
const SHA256 = "af34208ebcffdde21ea3a727e24743b60c808f0dd5df303b52a3f476483429fc"
const Path = "internal/contract/source/experience/v1/contract.json"

//go:embed contract.json
var Bytes []byte
