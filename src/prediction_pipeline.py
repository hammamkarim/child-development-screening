import pickle
from pathlib import Path

import numpy as np
import pandas as pd

from catboost import CatBoostClassifier


class ChildDevelopmentPipeline:

    def __init__(self, root_path=None):

        if root_path is None:
            root_path = Path(__file__).resolve().parents[1]
        else:
            root_path = Path(root_path)

        self.root = root_path

        self.config_path = (
            self.root /
            "models" /
            "encoders" /
            "pipeline_config.pkl"
        )

        self.transe_path = (
            self.root /
            "models" /
            "transe" /
            "transe_model_full_train.pkl"
        )

        self.catboost_path = (
            self.root /
            "models" /
            "catboost" /
            "catboost_final.cbm"
        )

        # Load configuration
        with open(
            self.config_path,
            "rb"
        ) as f:

            self.config = pickle.load(f)

        # Load TransE
        with open(
            self.transe_path,
            "rb"
        ) as f:

            self.transe_model = pickle.load(f)

        # Load CatBoost
        self.catboost_model = (
            CatBoostClassifier()
        )

        self.catboost_model.load_model(
            self.catboost_path
        )

        # Load entity dan relation mapping
        entities_path = (
            self.root /
            "outputs" /
            "kg_entities.txt"
        )

        relations_path = (
            self.root /
            "outputs" /
            "kg_relations.txt"
        )

        with open(
            entities_path,
            "r",
            encoding="utf-8"
        ) as f:
            entities = [
                line.strip()
                for line in f
                if line.strip()
            ]

        with open(
            relations_path,
            "r",
            encoding="utf-8"
        ) as f:
            relations = [
                line.strip()
                for line in f
                if line.strip()
            ]

        self.entity_to_id = {
            entity: idx
            for idx, entity in enumerate(entities)
        }

        self.relation_to_id = {
            relation: idx
            for idx, relation in enumerate(relations)
        }

        self.entity_embeddings = (
            self.transe_model
            .entity_representations[0]()
            .detach()
            .cpu()
            .numpy()
        )

        self.relation_embeddings = (
            self.transe_model
            .relation_representations[0]()
            .detach()
            .cpu()
            .numpy()
        )

    def _nearest_numeric_entity(
        self,
        feature,
        value
    ):

        reference_values = (
            self.config[
                "numeric_reference_values"
            ][feature]
        )

        value = float(value)

        nearest_value = min(
            reference_values,
            key=lambda x:
            abs(x - value)
        )

        # Nama entity pada kg_entities.txt memakai 6 angka desimal,
        # lalu nol di belakang dihapus. Samakan format agar, misalnya,
        # height_0.028571 tidak berubah menjadi height_0.0285714.
        formatted_value = f"{nearest_value:.6f}".rstrip("0").rstrip(".")
        return f"{feature}_{formatted_value}"

    def _get_tail_entity(
        self,
        feature,
        value
    ):

        if feature in self.config[
            "numeric_features"
        ]:

            entity = (
                self._nearest_numeric_entity(
                    feature,
                    value
                )
            )

        else:

            entity = (
                f"{feature}_{value}"
            )

        if entity not in self.entity_to_id:

            raise ValueError(
                f"Entity tidak ditemukan: {entity}"
            )

        return entity

    def _create_kge_embedding(
        self,
        row
    ):

        vectors = []

        for feature in self.config[
            "original_features"
        ]:

            relation = (
                self.config[
                    "relation_map"
                ][feature]
            )

            tail_entity = (
                self._get_tail_entity(
                    feature,
                    row[feature]
                )
            )

            tail_id = (
                self.entity_to_id[
                    tail_entity
                ]
            )

            relation_id = (
                self.relation_to_id[
                    relation
                ]
            )

            child_vector = (
                self.entity_embeddings[
                    tail_id
                ]
                -
                self.relation_embeddings[
                    relation_id
                ]
            )

            vectors.append(
                child_vector
            )

        return np.mean(
            vectors,
            axis=0
        )

    def transform(
        self,
        input_data
    ):

        if isinstance(
            input_data,
            dict
        ):

            input_df = pd.DataFrame(
                [input_data]
            )

        else:

            input_df = input_data.copy()

        required_features = (
            self.config[
                "original_features"
            ]
        )

        missing = [
            feature
            for feature in required_features
            if feature not in input_df.columns
        ]

        if missing:

            raise ValueError(
                f"Feature kurang: {missing}"
            )

        kge_embeddings = np.vstack([
            self._create_kge_embedding(
                row
            )
            for _, row in input_df.iterrows()
        ])

        kge_df = pd.DataFrame(
            kge_embeddings,
            columns=self.config[
                "kge_columns"
            ]
        )

        original_df = (
            input_df[
                required_features
            ]
            .reset_index(drop=True)
        )

        final_df = pd.concat(
            [
                original_df,
                kge_df
            ],
            axis=1
        )

        return final_df

    def predict(
        self,
        input_data
    ):

        features = self.transform(
            input_data
        )

        prediction = (
            self.catboost_model
            .predict(features)
            .ravel()
        )

        return prediction

    def predict_proba(
        self,
        input_data
    ):

        features = self.transform(
            input_data
        )

        return (
            self.catboost_model
            .predict_proba(features)
        )