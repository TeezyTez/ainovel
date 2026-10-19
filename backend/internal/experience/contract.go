package experience

import (
	"bytes"
	"crypto/sha256"
	experiencev1 "elselife/backend/internal/contract/source/experience/v1"
	"encoding/hex"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const ContractCommit = experiencev1.Revision
const ContractSHA256 = experiencev1.SHA256

var Contract = experiencev1.Bytes
var schemaOnce sync.Once
var schemas = map[string]*jsonschema.Schema{}
var schemaErr error

func validateContract(raw []byte, kind string) error {
	schemaOnce.Do(func() {
		sum := sha256.Sum256(Contract)
		if hex.EncodeToString(sum[:]) != ContractSHA256 {
			schemaErr = fail("contract_mismatch")
			return
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(Contract))
		if err != nil {
			schemaErr = err
			return
		}
		compiler := jsonschema.NewCompiler()
		const uri = "https://elselife.invalid/contracts/experience/v1"
		if err = compiler.AddResource(uri, doc); err != nil {
			schemaErr = err
			return
		}
		for _, kind := range []string{"context", "candidate", "read_request", "read_reply", "read_failure"} {
			schemas[kind], err = compiler.Compile(uri + "#/$defs/" + kind)
			if err != nil {
				schemaErr = err
				return
			}
		}
	})
	if schemaErr != nil {
		return fail("contract_unavailable")
	}
	v, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return fail("invalid_candidate")
	}
	schema := schemas[kind]
	if schema == nil {
		return fail("contract_unavailable")
	}
	if err = schema.Validate(v); err != nil {
		return fail("invalid_candidate")
	}
	return nil
}
func DecodeCandidate(raw []byte) (Candidate, error) {
	var c Candidate
	if err := validateContract(raw, "candidate"); err != nil {
		return c, err
	}
	return c, StrictJSON(raw, &c)
}
